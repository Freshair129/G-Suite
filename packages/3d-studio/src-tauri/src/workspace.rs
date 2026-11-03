use std::{
    fs,
    path::{Path, PathBuf},
};
pub struct StudioPaths {
    pub blender: Option<PathBuf>,
    pub workspace: PathBuf,
}
impl StudioPaths {
    pub fn resolve(
        app_data: &Path,
        blender: Option<PathBuf>,
        workspace: Option<PathBuf>,
    ) -> Result<Self, String> {
        for (name, path) in [
            ("G_STUDIO_BLENDER_PATH", blender.as_ref()),
            ("G_STUDIO_WORKSPACE_ROOT", workspace.as_ref()),
        ] {
            if path.is_some_and(|value| !value.is_absolute()) {
                return Err(format!("{name} must be an absolute path."));
            }
        }
        Ok(Self {
            blender,
            workspace: workspace.unwrap_or_else(|| app_data.join("projects")),
        })
    }
}
pub fn valid_project_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    !name.is_empty()
        && name.len() <= 64
        && !reserved.contains(&upper.as_str())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
pub fn create_project(root: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_project_name(name) {
        return Err("Use A-Z, 0-9, hyphen or underscore (1-64 characters), excluding Windows reserved names.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let project = fs::canonicalize(root)
        .map_err(|e| e.to_string())?
        .join(name);
    // Atomic reservation: existing directories, files and symlinks are never reused.
    fs::create_dir(&project).map_err(|e| e.to_string())?;
    for directory in ["source", "exports", "previews"] {
        fs::create_dir(project.join(directory)).map_err(|e| e.to_string())?;
    }
    Ok(project)
}
