use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

pub struct InboundEvent {
    pub value: Value,
    pub received_at: Instant,
    pub pending_at_dispatch: usize,
}

pub struct Sender {
    sender: mpsc::SyncSender<(Value, Instant)>,
    pending: Arc<AtomicUsize>,
    failure: Arc<Mutex<Option<std::io::ErrorKind>>>,
}

pub struct Receiver {
    receiver: mpsc::Receiver<(Value, Instant)>,
    pending: Arc<AtomicUsize>,
    failure: Arc<Mutex<Option<std::io::ErrorKind>>>,
}

pub fn channel() -> (Sender, Receiver) {
    let (sender, receiver) = mpsc::sync_channel(4096);
    let pending = Arc::new(AtomicUsize::new(0));
    let failure = Arc::new(Mutex::new(None));
    (Sender { sender, pending: pending.clone(), failure: failure.clone() }, Receiver { receiver, pending, failure })
}

impl Sender {
    pub fn record_transport_failure(&self, kind: std::io::ErrorKind) {
        if let Ok(mut failure) = self.failure.lock() { failure.get_or_insert(kind); }
    }

    pub fn send(&self, value: Value) -> Result<(), mpsc::SendError<(Value, Instant)>> {
        self.send_at(value, Instant::now())
    }

    pub fn send_at(&self, value: Value, received_at: Instant) -> Result<(), mpsc::SendError<(Value, Instant)>> {
        // Includes the single reader awaiting admission when the bounded channel
        // is full. This is local pending work, separate from supervisor credits.
        self.pending.fetch_add(1, Ordering::AcqRel);
        let result = self.sender.send((value, received_at));
        if result.is_err() { self.pending.fetch_sub(1, Ordering::AcqRel); }
        result
    }
}

impl Receiver {
    pub fn transport_failure(&self) -> Option<std::io::ErrorKind> {
        self.failure.lock().map(|failure| *failure).unwrap_or(Some(std::io::ErrorKind::Other))
    }

    pub fn pending(&self) -> usize {
        self.pending.load(Ordering::Acquire)
    }

    pub fn try_recv(&self) -> Result<InboundEvent, mpsc::TryRecvError> {
        let (value, received_at) = self.receiver.try_recv()?;
        let pending_at_dispatch = self.pending.fetch_sub(1, Ordering::AcqRel).saturating_sub(1);
        Ok(InboundEvent { value, received_at, pending_at_dispatch })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn ingress_carries_actual_monotonic_residence_and_its_own_pending_population() {
        let (sender, receiver) = channel();
        let entered = Instant::now();
        sender.send_at(serde_json::json!({"event":"log"}), entered).unwrap();
        sender.send_at(serde_json::json!({"event":"runtime:metrics"}), entered).unwrap();
        let event = receiver.try_recv().unwrap();
        assert_eq!((entered + Duration::from_millis(75)).duration_since(event.received_at), Duration::from_millis(75));
        assert_eq!(event.pending_at_dispatch, 1);
        assert_eq!(receiver.try_recv().unwrap().pending_at_dispatch, 0);
    }
}
