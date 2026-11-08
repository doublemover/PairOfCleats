use crate::event_ingress::{InboundEvent, Receiver};
use serde_json::Value;
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};
use std::process::Child;
use std::sync::mpsc::TryRecvError;
use std::time::{Duration, Instant};

const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

/// Keep the original terminal/transport/supervisor error as the source while
/// reporting a simultaneous containment failure instead of silently hiding it.
pub fn combine_session_outcomes(
    execution: anyhow::Result<()>,
    shutdown: anyhow::Result<()>,
) -> anyhow::Result<()> {
    match (execution, shutdown) {
        (Err(primary), Err(cleanup)) => Err(primary.context(format!(
            "Owned supervisor shutdown also failed: {cleanup:#}"
        ))),
        (Err(primary), Ok(())) => Err(primary),
        (Ok(()), shutdown) => shutdown,
    }
}

fn shutdown_outcome(status: std::process::ExitStatus, forced: bool) -> anyhow::Result<()> {
    if forced {
        anyhow::bail!("Owned supervisor exceeded its graceful shutdown deadline; containment was required ({status})");
    }
    if !status.success() {
        anyhow::bail!("Owned supervisor exited unsuccessfully during shutdown: {status}");
    }
    Ok(())
}

fn join_shutdown_outcomes(
    primary: anyhow::Result<()>,
    cleanup: impl IntoIterator<Item = std::io::Result<()>>,
) -> anyhow::Result<()> {
    cleanup.into_iter().fold(primary, |outcome, next| {
        combine_session_outcomes(outcome, next.map_err(Into::into))
    })
}

#[cfg(target_os = "linux")]
fn process_identity(pid: u32) -> std::io::Result<(u32, u64)> {
    use std::io::Read;
    let file = std::fs::File::open(format!("/proc/{pid}/stat"))?;
    let mut text = String::new();
    file.take(4097).read_to_string(&mut text)?;
    if text.len() > 4096 {
        return Err(std::io::Error::other("Process identity exceeds its bound"));
    }
    // comm may contain spaces and parentheses. Fields after its final closing
    // parenthesis begin with state, ppid, and ultimately starttime (field 22).
    let fields: Vec<_> = text
        .rsplit_once(')')
        .ok_or_else(|| std::io::Error::other("Invalid process identity"))?
        .1
        .split_whitespace()
        .collect();
    let parent = fields.get(1).and_then(|p| p.parse().ok());
    let started = fields.get(19).and_then(|p| p.parse().ok());
    parent
        .zip(started)
        .ok_or_else(|| std::io::Error::other("Invalid process identity"))
}

#[cfg(target_os = "linux")]
fn owned_processes() -> std::io::Result<HashMap<u32, u64>> {
    // Some Linux kernels omit task/PID/children. Read bounded parent relations
    // instead; selection is exclusively ancestry rooted at this application.
    let mut children: HashMap<u32, Vec<(u32, u64)>> = HashMap::new();
    let mut examined = 0usize;
    for entry in std::fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        examined += 1;
        if examined > 16384 {
            return Err(std::io::Error::other(
                "Process relation inventory exceeds its bound",
            ));
        }
        match process_identity(pid) {
            Ok((parent, started)) => children.entry(parent).or_default().push((pid, started)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    let mut pending = vec![std::process::id()];
    let mut owned = HashMap::new();
    while let Some(parent) = pending.pop() {
        for &(pid, started) in children.get(&parent).into_iter().flatten() {
            if pid > 1 && pid != std::process::id() && owned.insert(pid, started).is_none() {
                pending.push(pid);
            }
        }
    }
    Ok(owned)
}

/// Linux retains orphaned owned descendants so supervisor failure cannot abandon them.
pub fn prepare_containment() -> anyhow::Result<()> {
    #[cfg(target_os = "linux")]
    {
        unsafe extern "C" {
            fn prctl(option: i32, ...) -> i32;
        }
        if unsafe { prctl(36, 1_i32, 0_i32, 0_i32, 0_i32) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    Ok(())
}

pub struct SupervisorLifetime {
    child: Child,
    events: Receiver,
    active_groups: HashMap<String, u32>,
    closed: bool,
    #[cfg(windows)]
    job: windows::Job,
}

impl SupervisorLifetime {
    pub fn pending_events(&self) -> usize {
        self.events.pending()
    }

    pub fn new(mut child: Child, events: Receiver) -> anyhow::Result<Self> {
        #[cfg(windows)]
        let job = match windows::Job::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        // Mutable is necessary only for the Windows failure path.
        let _ = &mut child;
        Ok(Self {
            child,
            events,
            active_groups: HashMap::new(),
            closed: false,
            #[cfg(windows)]
            job,
        })
    }

    pub fn poll(&mut self) -> Result<InboundEvent, TryRecvError> {
        let received = self.events.try_recv()?;
        let event = &received.value;
        let job_id = event.get("jobId").and_then(Value::as_str).unwrap_or("");
        match event.get("event").and_then(Value::as_str) {
            Some("job:spawn") => {
                let pid = event.get("pid").and_then(Value::as_u64).or_else(|| {
                    event
                        .get("payload")
                        .and_then(|p| p.get("pid"))
                        .and_then(Value::as_u64)
                });
                if let Some(pid) = pid.and_then(|p| u32::try_from(p).ok()).filter(|p| *p > 1) {
                    self.active_groups.insert(job_id.to_owned(), pid);
                }
            }
            Some("job:end") => {
                self.active_groups.remove(job_id);
            }
            _ => {}
        }
        Ok(received)
    }

    pub fn shutdown(&mut self, mut observe: impl FnMut(InboundEvent)) -> anyhow::Result<()> {
        if self.closed {
            return Ok(());
        }
        // EOF is the supported graceful shutdown request. Closing cannot block
        // behind a full input pipe before the shutdown grace even starts.
        drop(self.child.stdin.take());
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            while let Ok(event) = self.poll() {
                observe(event);
                if Instant::now() >= deadline {
                    break;
                }
            }
            if let Some(status) = self.child.try_wait()? {
                while let Ok(event) = self.poll() {
                    observe(event);
                }
                let containment = self.contain_remaining();
                let reaped = self.child.wait().map(|_| ());
                let drained = self.drain_closed_output(&mut observe);
                self.closed = containment.is_ok() && reaped.is_ok() && drained.is_ok();
                return join_shutdown_outcomes(
                    shutdown_outcome(status, false),
                    [containment, reaped, drained],
                );
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let containment = self.contain_remaining();
        let _ = self.child.kill();
        let reaped = self.child.wait();
        let final_containment = self.contain_remaining();
        let drained = self.drain_closed_output(&mut observe);
        self.closed =
            containment.is_ok() && reaped.is_ok() && final_containment.is_ok() && drained.is_ok();
        let primary = match &reaped {
            Ok(status) => shutdown_outcome(*status, true),
            Err(_) => Err(anyhow::anyhow!("Owned supervisor exceeded its graceful shutdown deadline; containment was required")),
        };
        join_shutdown_outcomes(
            primary,
            [containment, reaped.map(|_| ()), final_containment, drained],
        )
    }

    fn drain_closed_output(
        &mut self,
        observe: &mut impl FnMut(InboundEvent),
    ) -> std::io::Result<()> {
        let until = Instant::now() + Duration::from_millis(500);
        loop {
            if Instant::now() >= until {
                return Err(std::io::Error::other(
                    "Supervisor output did not finish draining",
                ));
            }
            match self.poll() {
                Ok(event) => observe(event),
                Err(TryRecvError::Disconnected) => {
                    return match self.events.transport_failure() {
                        Some(kind) => Err(std::io::Error::new(
                            kind,
                            format!(
                                "Supervisor output transport failed during shutdown ({kind:?})"
                            ),
                        )),
                        None => Ok(()),
                    }
                }
                Err(TryRecvError::Empty) => {
                    if Instant::now() >= until {
                        return Err(std::io::Error::other(
                            "Supervisor output did not finish draining",
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        }
    }

    fn contain_remaining(&mut self) -> std::io::Result<()> {
        #[cfg(target_os = "linux")]
        {
            // Select only this application's owned process ancestry.
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
                fn waitpid(pid: i32, status: *mut i32, options: i32) -> i32;
            }
            let until = Instant::now() + Duration::from_millis(500);
            loop {
                let owned = owned_processes()?;
                if owned.is_empty() {
                    return Ok(());
                }
                for (pid, started) in &owned {
                    // Recheck starttime before signaling: PID reuse does not
                    // transfer ownership to the replacement process.
                    if process_identity(*pid).is_ok_and(|(_, current)| current == *started) {
                        let _ = unsafe { kill(*pid as i32, 9) };
                    }
                }
                // Child::try_wait owns the supervisor PID; waitpid reaps adopted descendants.
                let _ = self.child.try_wait()?;
                for pid in owned.keys().filter(|pid| **pid != self.child.id()) {
                    let _ = unsafe { waitpid(*pid as i32, std::ptr::null_mut(), 1) };
                }
                if Instant::now() >= until {
                    return Err(std::io::Error::other(
                        "Owned process containment did not reach quiescence",
                    ));
                }
                // Repeat ancestry after killed parents exit: a final concurrent fork
                // is adopted by this subreaper and cannot escape a one-shot snapshot.
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        #[cfg(all(unix, not(target_os = "linux")))]
        {
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            for pid in self.active_groups.values() {
                let _ = unsafe { kill(-(*pid as i32), 9) };
            }
            let _ = unsafe { kill(-(self.child.id() as i32), 9) };
        }
        #[cfg(windows)]
        self.job.terminate()?;
        #[cfg(not(target_os = "linux"))]
        Ok(())
    }
}

impl Deref for SupervisorLifetime {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl DerefMut for SupervisorLifetime {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}
impl Drop for SupervisorLifetime {
    fn drop(&mut self) {
        if self.shutdown(|_| {}).is_err() {
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = self.contain_remaining();
            self.closed = true;
        }
    }
}

#[cfg(test)]
mod outcome_tests {
    use super::*;
    #[test]
    fn original_failure_and_unknown_containment_are_both_reported() {
        let error = combine_session_outcomes(
            Err(anyhow::anyhow!("original terminal transport failure")),
            Err(anyhow::anyhow!(
                "owned Windows job termination remains pending"
            )),
        )
        .unwrap_err();
        let displayed = format!("{error:#}");
        assert!(displayed.contains("owned Windows job termination remains pending"));
        assert_eq!(
            error.root_cause().to_string(),
            "original terminal transport failure"
        );
        assert!(combine_session_outcomes(Ok(()), Err(anyhow::anyhow!("cleanup failure"))).is_err());
        assert!(combine_session_outcomes(Ok(()), Ok(())).is_ok());
    }

    #[test]
    fn every_independent_shutdown_failure_remains_visible() {
        let error = join_shutdown_outcomes(
            Err(anyhow::anyhow!("original supervisor exit failure")),
            [
                Err(std::io::Error::other("exact job termination unknown")),
                Err(std::io::Error::other("child wait failed")),
                Err(std::io::Error::other("last output frame not drained")),
            ],
        )
        .unwrap_err();
        let text = format!("{error:#}");
        for expected in [
            "original supervisor exit failure",
            "exact job termination unknown",
            "child wait failed",
            "last output frame not drained",
        ] {
            assert!(text.contains(expected));
        }
        assert_eq!(
            error.root_cause().to_string(),
            "original supervisor exit failure"
        );
    }

    #[cfg(windows)]
    #[test]
    fn nonzero_exit_and_forced_containment_cannot_be_clean_shutdown() {
        use std::os::windows::process::ExitStatusExt;
        assert!(shutdown_outcome(std::process::ExitStatus::from_raw(0), false).is_ok());
        assert!(
            shutdown_outcome(std::process::ExitStatus::from_raw(19), false)
                .unwrap_err()
                .to_string()
                .contains("unsuccessfully")
        );
        assert!(
            shutdown_outcome(std::process::ExitStatus::from_raw(0), true)
                .unwrap_err()
                .to_string()
                .contains("containment was required")
        );
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::time::{Duration, Instant};
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working: usize,
        max_working: usize,
        active_limit: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        counters: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Accounting {
        times: [i64; 4],
        page_faults: u32,
        total_processes: u32,
        active_processes: u32,
        terminated_processes: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(
            job: Handle,
            class: u32,
            info: *const c_void,
            length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn QueryInformationJobObject(
            job: Handle,
            class: u32,
            info: *mut c_void,
            length: u32,
            returned: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    pub struct Job(Handle);
    impl Job {
        pub fn attach(child: &Child) -> std::io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let job = Self(handle);
            let mut limits = ExtendedLimits::default();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if unsafe {
                SetInformationJobObject(
                    handle,
                    9,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            } == 0
                || unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(job)
        }
        pub fn terminate(&self) -> std::io::Result<()> {
            if unsafe { TerminateJobObject(self.0, 130) } == 0 {
                return Err(std::io::Error::last_os_error());
            }
            // TerminateJobObject requests termination asynchronously. The exact
            // owned job's active-process count, not a PID lookup or request result,
            // witnesses quiescence before the lifetime owner reports settlement.
            let deadline = Instant::now() + Duration::from_millis(500);
            loop {
                let mut accounting = Accounting::default();
                if unsafe {
                    QueryInformationJobObject(
                        self.0,
                        1,
                        &mut accounting as *mut _ as *mut c_void,
                        std::mem::size_of::<Accounting>() as u32,
                        std::ptr::null_mut(),
                    )
                } == 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                if accounting.active_processes == 0 {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err(std::io::Error::other(
                        "Owned Windows job termination remains pending",
                    ));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}
