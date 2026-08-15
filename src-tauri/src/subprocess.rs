use tokio::process::Command;

pub fn isolate_process_tree(command: &mut Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }

    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
}

pub fn kill_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };

    #[cfg(unix)]
    unsafe {
        // The child is its own process-group leader, so a negative PID reaches
        // npm/Node wrappers and their native CLI descendants together.
        libc::kill(-(pid as i32), libc::SIGKILL);
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}
