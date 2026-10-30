use super::*;

impl WorkflowUi {
    /// Recovery navigates to a canonical form. Selection/preview/launch retain
    /// their existing owners; this path never discards an outstanding owner.
    pub fn open_recovery(&mut self, repo: &str, command: &'static str) -> bool {
        if !self.available
            || !["index.validate", "tooling.doctor"].contains(&command)
            || repo.is_empty()
            || repo.len() > 4096
            || repo.contains('\0')
            || self.pending.is_some()
            || self.preview.is_some()
            || self.owned_job.is_some()
            || self.continuation_params().is_some()
            || !self.services.is_empty()
        {
            return false;
        }
        self.target = repo.into();
        self.workspace = false;
        self.recovery_command = Some(command);
        self.request("select", json!({"kind":"repo", "target":repo}));
        self.status =
            "Selecting the failed request's repository for a diagnostic form; no command started"
                .into();
        self.revision += 1;
        true
    }

    pub(super) fn apply_recovery(&mut self) {
        let Some(id) = self.recovery_command.take() else {
            return;
        };
        let command = self
            .commands()
            .into_iter()
            .find(|command| command["id"] == id)
            .cloned();
        let Some(command) = command else {
            self.status =
                "The requested diagnostic form is unavailable in this command catalog".into();
            return;
        };
        if command["unsupportedReason"].is_string() {
            self.status = "The diagnostic command has no native adapter; no command started".into();
            return;
        }
        self.command = Some(command);
        self.values.clear();
        self.selected = 0;
        self.page = Page::Fields;
        self.status =
            "Recovery form selected; review the original repository and fields, then p previews"
                .into();
    }

    pub(super) fn clear_recovery(&mut self) {
        self.recovery_command = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_selects_only_the_original_scope_and_never_launches() {
        let mut ui = WorkflowUi {
            available: true,
            ..WorkflowUi::default()
        };
        assert!(ui.open_recovery("/original repository", "index.validate"));
        let select = ui.outbox.pop_front().unwrap();
        assert_eq!(select["method"], "select");
        assert_eq!(select["params"]["target"], "/original repository");
        assert!(!ui.open_recovery("/other repository", "tooling.doctor"));
        ui.event(&json!({"event":"job:end","jobId":select["jobId"],"status":"done","resultState":"complete",
            "result":{"method":"select","data":{"id":"scope-original","kind":"repo","target":"/original repository"}}}));
        let describe = ui.outbox.pop_front().unwrap();
        ui.event(&json!({"event":"job:end","jobId":describe["jobId"],"status":"done","resultState":"complete",
            "result":{"method":"describe","data":{"commands":[{"id":"index.validate","scopeKind":"repo","fields":[]}]}}}));
        assert!(ui.page == Page::Fields);
        assert_eq!(ui.command.as_ref().unwrap()["id"], "index.validate");
        assert!(ui.outbox.is_empty());
        assert!(ui.preview.is_none());
        ui.key(KeyCode::Char('p').into());
        let preview = ui.outbox.pop_front().unwrap();
        assert_eq!(preview["method"], "preview");
        assert_eq!(preview["params"]["scopeId"], "scope-original");
    }
    #[test]
    fn recovery_cannot_replace_reservations_or_choose_a_mutating_command() {
        let mut ui = WorkflowUi {
            available: true,
            ..WorkflowUi::default()
        };
        assert!(!ui.open_recovery("/repo", "tooling.install"));
        ui.preview = Some(json!({"previewId":"reserved"}));
        assert!(!ui.open_recovery("/repo", "index.validate"));
        assert!(ui.outbox.is_empty());
        assert_eq!(ui.preview.as_ref().unwrap()["previewId"], "reserved");
    }
}
