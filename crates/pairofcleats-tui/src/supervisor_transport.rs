use std::io::{self, BufRead};
use serde_json::{json, Value};
use crate::event_ingress::Sender;

// Canonical supervisor frames are chunked at 16 Ki characters. This outer byte
// cap also admits their Unicode/envelope overhead without an unbounded line read.
const MAX_FRAME_BYTES: usize = 128 * 1024;

fn read_frame(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if frame.is_empty() { Ok(None) } else {
                Err(io::Error::new(io::ErrorKind::UnexpectedEof, "Supervisor frame ended before its newline"))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let length = newline.map_or(available.len(), |index| index + 1);
        if frame.len().saturating_add(length) > MAX_FRAME_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "Supervisor frame exceeds its byte bound"));
        }
        frame.extend_from_slice(&available[..length]);
        reader.consume(length);
        if newline.is_some() { return Ok(Some(frame)); }
    }
}

/// Reads only bounded frames into the existing bounded ingress owner. A lost
/// pipe or oversized/incomplete frame closes this sender so the real session
/// owner can enter shutdown; neither an error frame nor saved data grants control.
pub fn read_events(mut reader: impl BufRead, sender: &Sender) -> io::Result<()> {
    let mut parse_failures = 0usize;
    while let Some(frame) = read_frame(&mut reader)? {
        if frame.iter().all(u8::is_ascii_whitespace) { continue; }
        match serde_json::from_slice::<Value>(&frame) {
            Ok(value) => if sender.send(value).is_err() { return Ok(()); },
            Err(error) => {
                parse_failures += 1;
                if parse_failures <= 8 && sender.send(json!({"event":"log", "level":"warn", "source":"tui-transport",
                    "message":format!("Supervisor frame JSON rejected at line {}, column {} (diagnostic {}/8)",
                        error.line(), error.column(), parse_failures)})).is_err() { return Ok(()); }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor, Read};
    use std::sync::mpsc::TryRecvError;
    use crate::event_ingress;

    #[test]
    fn unicode_and_final_frames_arrive_before_disconnect() {
        let (sender, receiver) = event_ingress::channel();
        read_events(Cursor::new("{\"event\":\"log\",\"message\":\"wide 漢 👩🏽‍💻\"}\n".as_bytes()), &sender).unwrap();
        drop(sender);
        assert_eq!(receiver.try_recv().unwrap().value["message"], "wide 漢 👩🏽‍💻");
        assert!(matches!(receiver.try_recv(), Err(TryRecvError::Disconnected)));
    }

    #[test]
    fn oversized_and_partial_lines_fail_before_json_allocation() {
        let mut huge = Cursor::new(vec![b'x'; MAX_FRAME_BYTES * 4]);
        assert_eq!(read_frame(&mut huge).unwrap_err().kind(), io::ErrorKind::InvalidData);
        assert_eq!(huge.position(), 0, "a fill_buf larger than the cap is rejected without copying it");
        assert_eq!(read_frame(&mut Cursor::new(b"{\"event\":\"log\"}".as_slice())).unwrap_err().kind(), io::ErrorKind::UnexpectedEof);
    }

    struct BrokenPipe;
    impl Read for BrokenPipe {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> { Err(io::Error::new(io::ErrorKind::BrokenPipe, "fixture")) }
    }
    #[test]
    fn reader_failure_is_not_treated_as_clean_end_of_stream() {
        let (sender, _) = event_ingress::channel();
        assert_eq!(read_events(BufReader::new(BrokenPipe), &sender).unwrap_err().kind(), io::ErrorKind::BrokenPipe);
    }
}
