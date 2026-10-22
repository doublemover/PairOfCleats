use std::collections::{BTreeMap, HashMap, VecDeque};
use std::mem::size_of;
use super::super::{AppModel, AlertEntry, BenchSummary, ChunkAssembly, IndexingSummary,
    LogEntry, RuntimeTelemetry, ServiceSummary, SessionState, TaskState, WorkloadKind, inspection};

/// Only reducer-derived state belongs to a checkpoint. Input, view filters,
/// selection, transport handles, request outboxes and live authority stay outside.
#[derive(Clone)]
pub(super) struct ReplayState {
    run_id: String,
    job_status: BTreeMap<String, String>,
    job_titles: BTreeMap<String, String>,
    job_order: VecDeque<String>,
    task_status: BTreeMap<String, TaskState>,
    task_identity: BTreeMap<String, (String, String)>,
    task_order: VecDeque<String>,
    logs: VecDeque<LogEntry>,
    alerts: VecDeque<AlertEntry>,
    session: SessionState,
    workload_kind: WorkloadKind,
    bench_summary: BenchSummary,
    indexing_summary: IndexingSummary,
    service_summary: ServiceSummary,
    chunk_assemblies: HashMap<String, ChunkAssembly>,
    chunk_assembly_bytes: usize,
    telemetry: RuntimeTelemetry,
    inspection: inspection::ReplayHistory,
}

impl ReplayState {
    pub(super) fn capture(model: &AppModel) -> Self {
        Self {
            run_id: model.run_id.clone(),
            job_status: model.job_status.clone(),
            job_titles: model.job_titles.clone(),
            job_order: model.job_order.clone(),
            task_status: model.task_status.clone(),
            task_identity: model.task_identity.clone(),
            task_order: model.task_order.clone(),
            logs: model.logs.clone(),
            alerts: model.alerts.clone(),
            session: model.session.clone(),
            workload_kind: model.workload_kind,
            bench_summary: model.bench_summary.clone(),
            indexing_summary: model.indexing_summary.clone(),
            service_summary: model.service_summary.clone(),
            chunk_assemblies: model.chunk_assemblies.clone(),
            chunk_assembly_bytes: model.chunk_assembly_bytes,
            telemetry: model.telemetry.clone(),
            inspection: model.job_inspection.replay_history(),
        }
    }

    pub(super) fn restore(&self, model: &mut AppModel) {
        model.run_id = self.run_id.clone();
        model.job_status = self.job_status.clone();
        model.job_titles = self.job_titles.clone();
        model.job_order = self.job_order.clone();
        model.task_status = self.task_status.clone();
        model.task_identity = self.task_identity.clone();
        model.task_order = self.task_order.clone();
        model.logs = self.logs.clone();
        model.alerts = self.alerts.clone();
        model.session = self.session.clone();
        model.workload_kind = self.workload_kind;
        model.bench_summary = self.bench_summary.clone();
        model.indexing_summary = self.indexing_summary.clone();
        model.service_summary = self.service_summary.clone();
        model.chunk_assemblies = self.chunk_assemblies.clone();
        model.chunk_assembly_bytes = self.chunk_assembly_bytes;
        model.telemetry = self.telemetry.clone();
        model.job_inspection.restore_replay_history(&self.inspection);
        model.dirty = true;
        model.last_render_signature.clear();
    }

    // Conservative retained-allocation charge, computed before copying. Shared
    // immutable inspection records are charged in full for every checkpoint.
    // Container reserves include per-node/table overhead as well as payloads.
    pub(super) fn retained_bytes(model: &AppModel) -> usize {
        let strings = |values: &[&String]| values.iter().map(|value| value.capacity()).sum::<usize>();
        let string_queue = |values: &VecDeque<String>| values.capacity() * size_of::<String>()
            + values.iter().map(String::capacity).sum::<usize>();
        let string_map = |values: &BTreeMap<String, String>| values.len() * (size_of::<(String, String)>() + 128)
            + values.iter().map(|(key, value)| key.capacity() + value.capacity()).sum::<usize>();
        size_of::<Self>() + model.run_id.capacity()
            + string_map(&model.job_status) + string_map(&model.job_titles)
            + string_queue(&model.job_order) + string_queue(&model.task_order)
            + model.task_status.len() * (size_of::<(String, TaskState)>() + 128)
            + model.task_status.iter().map(|(key, value)| key.capacity() + value.status.capacity()
                + value.message.as_ref().map_or(0, String::capacity)).sum::<usize>()
            + model.task_identity.len() * (size_of::<(String, (String, String))>() + 128)
            + model.task_identity.iter().map(|(key, (job, task))| key.capacity() + job.capacity() + task.capacity()).sum::<usize>()
            + model.logs.capacity() * size_of::<LogEntry>()
            + model.logs.iter().map(|entry| strings(&[&entry.text, &entry.level, &entry.source])
                + entry.job_id.as_ref().map_or(0, String::capacity)).sum::<usize>()
            + model.alerts.capacity() * size_of::<AlertEntry>()
            + model.alerts.iter().map(|entry| strings(&[&entry.level, &entry.message])).sum::<usize>()
            + strings(&[&model.session.mode, &model.session.source, &model.session.scope,
                &model.session.connection, &model.session.note,
                &model.bench_summary.lane, &model.bench_summary.tier, &model.bench_summary.active_repo,
                &model.bench_summary.artifact_stall, &model.bench_summary.timeout_state,
                &model.indexing_summary.repo, &model.indexing_summary.stage, &model.indexing_summary.mode,
                &model.indexing_summary.artifact_write_progress, &model.indexing_summary.sqlite_state,
                &model.indexing_summary.validation_state, &model.indexing_summary.promotion_state,
                &model.service_summary.service, &model.service_summary.quarantine_state,
                &model.service_summary.shutdown_state])
            + model.bench_summary.degraded_providers.capacity() * size_of::<String>()
            + model.bench_summary.degraded_providers.iter().map(String::capacity).sum::<usize>()
            + model.bench_summary.quality_signals.capacity() * size_of::<String>()
            + model.bench_summary.quality_signals.iter().map(String::capacity).sum::<usize>()
            + model.chunk_assemblies.capacity() * (size_of::<(String, ChunkAssembly)>() + 128)
            + model.chunk_assemblies.iter().map(|(key, assembly)| key.capacity()
                + assembly.parts.capacity() * size_of::<Option<String>>()
                + assembly.parts.iter().flatten().map(String::capacity).sum::<usize>()).sum::<usize>()
            + model.job_inspection.replay_history().retained_bytes()
    }
}
