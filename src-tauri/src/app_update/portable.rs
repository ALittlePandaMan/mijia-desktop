//! A verified portable package is applied by a copy of the running executable.
//! The helper waits for graceful shutdown, rolls back failed replacements, and
//! never touches the per-user account store or user media folders.
use super::{cache_directory, issue, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri_plugin_updater::Update;

#[derive(Serialize, Deserialize)]
struct Job {
    parent: u32,
    directory: PathBuf,
    version: String,
    signature: String,
    previous_sha256: String,
    restart: bool,
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn storage(_: impl std::fmt::Display) -> crate::error::AppError {
    issue("无法写入更新文件，请确认程序目录可写后重试。")
}
fn safe_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(issue("更新目录无效。"));
    }
    for parent in path.ancestors() {
        if fs::symlink_metadata(parent)
            .map_err(storage)?
            .file_type()
            .is_symlink()
        {
            return Err(issue("更新目录不能包含符号链接。"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if fs::symlink_metadata(parent)
                .map_err(storage)?
                .file_attributes()
                & 0x400
                != 0
            {
                return Err(issue("更新目录不能包含重解析点。"));
            }
        }
    }
    Ok(())
}
pub fn launch(update: &Update, bytes: &[u8], restart: bool) -> Result<()> {
    update
        .verify(bytes)
        .map_err(|_| issue("更新包签名校验失败，已阻止安装。"))?;
    let executable = std::env::current_exe().map_err(storage)?;
    let directory = executable
        .parent()
        .ok_or_else(|| issue("程序目录无效。"))?
        .to_owned();
    safe_directory(&directory)?;
    let probe = directory.join(format!(".update-write-{}", uuid::Uuid::new_v4()));
    fs::write(&probe, []).map_err(storage)?;
    fs::remove_file(probe).map_err(storage)?;
    let cache = cache_directory()?;
    fs::create_dir_all(&cache).map_err(storage)?;
    safe_directory(&cache)?;
    let folder = cache.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&folder).map_err(storage)?;
    let result = (|| {
        fs::write(folder.join("package.zip"), bytes).map_err(storage)?;
        fs::copy(&executable, folder.join("helper.exe")).map_err(storage)?;
        let job = Job {
            parent: std::process::id(),
            directory,
            version: update.version.clone(),
            signature: update.signature.clone(),
            previous_sha256: sha(&fs::read(&executable).map_err(storage)?),
            restart,
        };
        fs::write(
            folder.join("job.json"),
            serde_json::to_vec(&job).map_err(storage)?,
        )
        .map_err(storage)?;
        let mut helper = Command::new(folder.join("helper.exe"));
        helper
            .arg("--apply-portable-update")
            .arg(folder.join("job.json"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            helper.creation_flags(0x08000000);
        }
        helper.spawn().map_err(storage)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&folder);
    }
    result
}
fn verify(bytes: &[u8], job: &Job) -> Result<()> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).map_err(storage)?;
    let key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or_else(|| issue("更新公钥缺失。"))?;
    let decoded_key = STANDARD.decode(key).map_err(storage)?;
    let decoded_sig = STANDARD.decode(&job.signature).map_err(storage)?;
    let public_key =
        minisign_verify::PublicKey::decode(std::str::from_utf8(&decoded_key).map_err(storage)?)
            .map_err(storage)?;
    let signature =
        minisign_verify::Signature::decode(std::str::from_utf8(&decoded_sig).map_err(storage)?)
            .map_err(storage)?;
    public_key
        .verify(bytes, &signature, true)
        .map_err(|_| issue("更新包签名校验失败，已阻止安装。"))?;
    let signed = signature
        .trusted_comment()
        .split('\t')
        .find_map(|f| f.strip_prefix("version:"));
    let signed = signed.and_then(|v| semver::Version::parse(v.trim_start_matches('v')).ok());
    let announced = semver::Version::parse(job.version.trim_start_matches('v')).map_err(storage)?;
    if signed.as_ref() != Some(&announced)
        || announced <= semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap()
    {
        return Err(issue("更新包签名版本不匹配，已阻止安装。"));
    }
    Ok(())
}
fn payload_path(name: &str) -> Result<PathBuf> {
    let name = name.trim_end_matches('/');
    if name.is_empty()
        || name.contains(['\\', ':'])
        || name
            .split('/')
            .any(|p| p.is_empty() || p.ends_with(['.', ' ']))
    {
        return Err(issue("更新包包含无效路径。"));
    }
    let path = PathBuf::from(name);
    if !path.components().all(|p| matches!(p, Component::Normal(_))) {
        return Err(issue("更新包包含越界路径。"));
    }
    let first = name.split('/').next().unwrap();
    if !matches!(
        first,
        "mijia-desktop.exe"
            | ".mijia-desktop-portable"
            | "LICENSE"
            | "README.md"
            | "CHANGELOG.md"
            | "docs"
            | "licenses"
    ) || (name.contains('/') && !matches!(first, "docs" | "licenses"))
    {
        return Err(issue("更新包包含非应用文件。"));
    }
    Ok(path)
}
fn extract(bytes: &[u8], stage: &Path) -> Result<Vec<PathBuf>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(storage)?;
    if zip.len() > 20000 {
        return Err(issue("更新包文件数量超出限制。"));
    }
    let mut files = Vec::new();
    let mut names = HashSet::new();
    let mut size = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(storage)?;
        let name = entry.name().map_err(storage)?.into_owned();
        let relative = payload_path(&name)?;
        if !names.insert(name.trim_end_matches('/').to_ascii_lowercase()) || entry.is_symlink() {
            return Err(issue("更新包包含重复文件或符号链接。"));
        }
        let path = stage.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(storage)?;
            continue;
        }
        size = size
            .checked_add(entry.size())
            .ok_or_else(|| issue("更新包大小无效。"))?;
        if size > 512 * 1024 * 1024 {
            return Err(issue("更新包解压大小超出限制。"));
        }
        fs::create_dir_all(path.parent().unwrap()).map_err(storage)?;
        let mut file = fs::File::create(&path).map_err(storage)?;
        let expected = entry.size();
        let count =
            std::io::copy(&mut entry.by_ref().take(expected + 1), &mut file).map_err(storage)?;
        if count != expected {
            return Err(issue("更新包文件长度无效。"));
        }
        file.flush().map_err(storage)?;
        files.push(relative);
    }
    if !files.iter().any(|p| p == Path::new("mijia-desktop.exe"))
        || !files
            .iter()
            .any(|p| p == Path::new(".mijia-desktop-portable"))
    {
        return Err(issue("便携更新包不完整。"));
    }
    let binary = fs::read(stage.join("mijia-desktop.exe")).map_err(storage)?;
    let pe = binary
        .get(60..64)
        .map(|v| u32::from_le_bytes(v.try_into().unwrap()) as usize)
        .unwrap_or(usize::MAX);
    if !binary.starts_with(b"MZ")
        || binary.get(pe..pe.saturating_add(4)) != Some(b"PE\0\0")
        || binary.get(pe.saturating_add(4)..pe.saturating_add(6)) != Some(&0x8664u16.to_le_bytes())
    {
        return Err(issue("更新程序架构无效。"));
    }
    // Commit the executable last; rollback all replaced files if any rename fails.
    files.sort_by_key(|p| p == Path::new("mijia-desktop.exe"));
    Ok(files)
}
fn rename(from: &Path, to: &Path) -> std::io::Result<()> {
    for attempt in 0..20 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if attempt == 19 => return Err(e),
            Err(_) => std::thread::sleep(Duration::from_millis(150)),
        }
    }
    unreachable!()
}
fn replace(job: &Job, bytes: &[u8]) -> Result<()> {
    safe_directory(&job.directory)?;
    let binary = job.directory.join("mijia-desktop.exe");
    if sha(&fs::read(&binary).map_err(storage)?) != job.previous_sha256 {
        return Err(issue("程序文件已变化，已取消旧更新。"));
    }
    let work = job
        .directory
        .join(format!(".mijia-update-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&work).map_err(storage)?;
    let stage = work.join("new");
    let backup = work.join("old");
    fs::create_dir(&stage).map_err(storage)?;
    fs::create_dir(&backup).map_err(storage)?;
    let mut committed: Vec<(PathBuf, bool)> = Vec::new();
    let result = (|| {
        let files = extract(bytes, &stage)?;
        for relative in files {
            let target = job.directory.join(&relative);
            let parent = target.parent().unwrap();
            // Check existing ancestors before creating directories, including junctions.
            let ancestor = parent
                .ancestors()
                .find(|p| p.exists())
                .ok_or_else(|| issue("目标目录无效。"))?;
            safe_directory(ancestor)?;
            fs::create_dir_all(parent).map_err(storage)?;
            safe_directory(parent)?;
            let had = target.exists();
            if had {
                if !fs::symlink_metadata(&target).map_err(storage)?.is_file() {
                    return Err(issue("更新目标不是普通文件。"));
                }
                let save = backup.join(&relative);
                fs::create_dir_all(save.parent().unwrap()).map_err(storage)?;
                rename(&target, &save).map_err(storage)?;
            }
            committed.push((relative.clone(), had));
            rename(&stage.join(&relative), &target).map_err(storage)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let mut restored = true;
        for (relative, had) in committed.iter().rev() {
            let target = job.directory.join(relative);
            if target.exists() && fs::remove_file(&target).is_err() {
                restored = false;
                continue;
            }
            if *had && rename(&backup.join(relative), &target).is_err() {
                restored = false;
            }
        }
        if !restored {
            return Err(issue(
                "更新未完成，旧文件保留在程序目录的 .mijia-update 文件夹中，请恢复后重试。",
            ));
        }
    }
    // Only this helper-created, verified child directory may be removed recursively.
    let _ = fs::remove_dir_all(&work);
    result
}
#[cfg(windows)]
fn wait_parent(pid: u32) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return Ok(());
    }
    let result = unsafe { WaitForSingleObject(handle, 120000) };
    unsafe { CloseHandle(handle) };
    if result != WAIT_OBJECT_0 {
        return Err(issue("等待旧程序退出超时，未替换文件。"));
    }
    Ok(())
}
#[cfg(not(windows))]
fn wait_parent(_: u32) -> Result<()> {
    Err(issue("当前平台不支持便携更新。"))
}

pub fn helper_argument() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--apply-portable-update")) {
        return None;
    }
    let result = (|| {
        let job_path = PathBuf::from(args.next().ok_or_else(|| issue("更新任务缺失。"))?);
        let folder = job_path
            .parent()
            .ok_or_else(|| issue("更新任务目录无效。"))?;
        let cache = cache_directory()?.canonicalize().map_err(storage)?;
        if job_path.file_name() != Some(std::ffi::OsStr::new("job.json"))
            || folder.parent().and_then(|p| p.canonicalize().ok()).as_ref() != Some(&cache)
            || folder
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                .is_none()
            || std::env::current_exe()
                .map_err(storage)?
                .canonicalize()
                .map_err(storage)?
                != folder.join("helper.exe").canonicalize().map_err(storage)?
        {
            return Err(issue("更新任务来源无效。"));
        }
        safe_directory(folder)?;
        if fs::metadata(&job_path).map_err(storage)?.len() > 32768 {
            return Err(issue("更新任务过大。"));
        }
        let job: Job =
            serde_json::from_slice(&fs::read(&job_path).map_err(storage)?).map_err(storage)?;
        let package = folder.join("package.zip");
        if fs::metadata(&package).map_err(storage)?.len() > super::MAX_PACKAGE {
            return Err(issue("更新包过大。"));
        }
        let bytes = fs::read(&package).map_err(storage)?;
        let applied = (|| {
            wait_parent(job.parent)?;
            verify(&bytes, &job)?;
            replace(&job, &bytes)
        })();
        let summary = serde_json::json!({"success":applied.is_ok(),"version":job.version,"message":applied.as_ref().err().map(|e|e.message.clone())});
        if applied.is_err() {
            super::result::clear_failed();
        }
        let _ = crate::app_settings::atomic_write(
            &cache.join("last-result.json"),
            &serde_json::to_vec(&summary).unwrap(),
        );
        if job.restart {
            let _ = Command::new(job.directory.join("mijia-desktop.exe"))
                .current_dir(&job.directory)
                .spawn();
        }
        let _ = fs::remove_file(package);
        let _ = fs::remove_file(job_path);
        applied
    })();
    Some(if result.is_ok() { 0 } else { 1 })
}
pub fn previous_failure() -> Option<String> {
    let path = cache_directory().ok()?.join("last-result.json");
    let bytes = fs::read(&path).ok()?;
    if bytes.len() > 32768 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let _ = fs::remove_file(path);
    if value["success"] == false {
        value["message"].as_str().map(str::to_owned)
    } else {
        None
    }
}
