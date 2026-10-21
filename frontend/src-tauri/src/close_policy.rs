//! Shared policy for native window close, tray Quit and Cmd+Q.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExitEntry {
    WindowClose,
    ExplicitQuit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExitAction {
    HideToTray,
    PreventQuit,
    Exit,
}

pub(crate) fn decide_exit(
    entry: ExitEntry,
    recording_busy: bool,
    close_to_tray: bool,
) -> ExitAction {
    match entry {
        ExitEntry::WindowClose if recording_busy || close_to_tray => ExitAction::HideToTray,
        ExitEntry::ExplicitQuit if recording_busy => ExitAction::PreventQuit,
        ExitEntry::WindowClose => ExitAction::Exit,
        ExitEntry::ExplicitQuit => ExitAction::Exit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A missing busy check here would allow tray Quit or Cmd+Q to truncate audio.
    #[test]
    fn explicit_quit_is_blocked_while_starting_capturing_or_saving() {
        for preference in [false, true] {
            assert_eq!(
                decide_exit(ExitEntry::ExplicitQuit, true, preference),
                ExitAction::PreventQuit
            );
        }
    }

    #[test]
    fn busy_window_close_hides_even_when_user_prefers_exit() {
        assert_eq!(
            decide_exit(ExitEntry::WindowClose, true, false),
            ExitAction::HideToTray
        );
    }

    #[test]
    fn idle_window_close_obeys_preference() {
        assert_eq!(
            decide_exit(ExitEntry::WindowClose, false, false),
            ExitAction::Exit
        );
        assert_eq!(
            decide_exit(ExitEntry::WindowClose, false, true),
            ExitAction::HideToTray
        );
    }

    #[test]
    fn idle_explicit_quit_allows_cleanup_regardless_of_preference() {
        for preference in [false, true] {
            assert_eq!(
                decide_exit(ExitEntry::ExplicitQuit, false, preference),
                ExitAction::Exit
            );
        }
    }
}
