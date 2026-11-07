use super::*;
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

fn root() -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "g-suite-studio-listing-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn oversized_project_manifests_are_ignored_without_loading_the_full_file() {
    let workspace = root();
    let project = workspace.join("sample-project");
    fs::create_dir_all(&project).unwrap();
    let manifest = json!({
        "state": "ready",
        "provenance": "x".repeat(MAX_PROJECT_MANIFEST_BYTES as usize + 1),
    });
    fs::write(
        project.join("studio-project.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();

    let projects = list_projects_in_workspace(&workspace).unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].state, "review-pending");
    assert_eq!(projects[0].provenance, "missing-manifest");
    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn project_source_junction_is_not_enumerated() {
    let workspace = root();
    let project = workspace.join("sample-project");
    let external = workspace.join("external.source");
    fs::create_dir_all(&project).unwrap();
    fs::create_dir_all(&external).unwrap();
    fs::write(external.join("outside.blend"), b"external source").unwrap();
    let source = project.join("source");

    #[cfg(windows)]
    {
        // Avoid cmd.exe /C re-parsing quoted Windows paths. The paths travel
        // through environment variables so spaces and shell metacharacters are
        // not interpreted as part of the PowerShell command.
        let output = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "New-Item -ItemType Junction -Path $env:G_SUITE_TEST_JUNCTION_LINK -Target $env:G_SUITE_TEST_JUNCTION_TARGET -ErrorAction Stop | Out-Null",
            ])
            .env("G_SUITE_TEST_JUNCTION_LINK", &source)
            .env("G_SUITE_TEST_JUNCTION_TARGET", &external)
            .output()
            .unwrap();
        let details = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.status.success(), "junction setup failed: {details}");
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&external, &source).unwrap();

    let projects = list_projects_in_workspace(&workspace).unwrap();
    assert_eq!(projects.len(), 1);
    assert!(!projects[0].has_blend_source);
    assert!(!projects[0].source_scan_limited);
    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn large_source_directories_are_bounded_and_report_partial_scans() {
    let workspace = root();
    let source = workspace.join("sample-project").join("source");
    fs::create_dir_all(&source).unwrap();
    for index in 0..=MAX_SOURCE_ENTRIES {
        fs::write(source.join(format!("source-{index:04}.txt")), b"source").unwrap();
    }

    let projects = list_projects_in_workspace(&workspace).unwrap();
    assert_eq!(projects.len(), 1);
    assert!(!projects[0].has_blend_source);
    assert!(projects[0].source_scan_limited);
    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn oversized_workspace_fails_before_unbounded_project_enumeration() {
    let workspace = root();
    for index in 0..=MAX_WORKSPACE_ENTRIES {
        fs::create_dir(workspace.join(format!("project-{index:04}"))).unwrap();
    }

    let error = list_projects_in_workspace(&workspace).err().unwrap();
    assert!(error.contains("workspace entry limit"), "{error}");
    fs::remove_dir_all(workspace).unwrap();
}
