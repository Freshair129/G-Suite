#[path = "workspace.rs"]
mod workspace;

use std::{fs, path::PathBuf};
use workspace::{create_project, StudioPaths};

fn temporary_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "g-suite-studio-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn unconfigured_blender_does_not_block_status_or_create_directories() {
    let root = temporary_root();
    let paths = StudioPaths::resolve(&root, None, None).unwrap();
    assert_eq!(paths.workspace, root.join("projects"));
    assert!(paths.blender.is_none());
    assert!(!root.exists());
}

#[test]
fn explicit_absolute_paths_preserve_external_workspace() {
    let root = temporary_root();
    let blender = root.join("Blender folder").join("blender.exe");
    let assets = root.join("Thai ไทย assets");
    let paths = StudioPaths::resolve(&root, Some(blender.clone()), Some(assets.clone())).unwrap();
    assert_eq!(paths.blender, Some(blender));
    assert_eq!(paths.workspace, assets);
    assert!(!root.exists());
}

#[test]
fn relative_and_empty_overrides_are_rejected() {
    let root = temporary_root();
    for bad in ["", "relative/path", "../escape"] {
        assert!(StudioPaths::resolve(&root, Some(PathBuf::from(bad)), None).is_err());
        assert!(StudioPaths::resolve(&root, None, Some(PathBuf::from(bad))).is_err());
    }
}

#[test]
fn create_is_bounded_and_never_overwrites_existing_project() {
    let root = temporary_root();
    for name in [
        "",
        "../escape",
        "a/b",
        "a\\b",
        ".",
        "..",
        "ไทย",
        "CON",
        "nul",
        "COM1",
        "LPT9",
    ] {
        assert!(create_project(&root, name).is_err(), "accepted {name}");
    }
    assert!(!root.exists());
    let project = create_project(&root, "sample-01").unwrap();
    assert!(project.join("source").is_dir());
    fs::write(project.join("source/keep.txt"), "preserve").unwrap();
    assert!(create_project(&root, "sample-01").is_err());
    assert_eq!(
        fs::read_to_string(project.join("source/keep.txt")).unwrap(),
        "preserve"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unicode_and_space_root_creates_real_project_without_overwriting_a_file() {
    let root = temporary_root().join("Thai ไทย assets with spaces");
    let project = create_project(&root, "unicode-root").unwrap();
    assert!(project.join("previews").is_dir());
    let existing = root.join("existing-file");
    fs::write(&existing, b"original").unwrap();
    assert!(create_project(&root, "existing-file").is_err());
    assert_eq!(fs::read(&existing).unwrap(), b"original");
    fs::remove_dir_all(root.parent().unwrap()).unwrap();
}

#[test]
fn concurrent_creation_has_one_winner_and_never_reuses_destination() {
    let root = temporary_root();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                create_project(&root, "same-name")
            })
        })
        .collect();
    let successes = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .filter(Result::is_ok)
        .count();
    assert_eq!(successes, 1);
    assert!(root.join("same-name/source").is_dir());
    fs::remove_dir_all(root).unwrap();
}
