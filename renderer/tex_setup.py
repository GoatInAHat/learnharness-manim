"""Install the pinned, plugin-local TeX toolchain used by Manim MathTex."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


DOWNLOAD_HOSTS = {"github.com", "release-assets.githubusercontent.com", "texlive.info"}


def check_url(url):
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in DOWNLOAD_HOSTS or parts.username or parts.password:
        raise ValueError("Unexpected TeX download location.")


class Redirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, destination):
        check_url(destination)
        return super().redirect_request(request, fp, code, message, headers, destination)


def locked_archive(spec, folder, local):
    filename = spec["filename"] if "filename" in spec else spec["name"] + ".tar.xz"
    if Path(filename).name != filename:
        raise ValueError("Invalid TeX archive name.")
    path = folder / filename
    check_url(spec["url"])
    digest = hashlib.sha256()
    length = 0
    if local:
        source = (local / filename).open("rb")
    else:
        print(f"Downloading verified TeX asset {filename}.", file=sys.stderr, flush=True)
        request = Request(spec["url"], headers={"User-Agent": "curl/8.7.1", "Accept": "application/octet-stream"})
        source = build_opener(ProxyHandler({}), Redirects()).open(request, timeout=60)
    with source, path.open("xb") as output:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            length += len(block)
            if length > spec["size"]:
                raise ValueError("TeX archive exceeded its locked size.")
            digest.update(block)
            output.write(block)
    if length != spec["size"] or digest.hexdigest() != spec["sha256"]:
        raise ValueError("TeX archive failed its size or SHA-256 check.")
    return path


def extract(path, target, base_root=None):
    def safe(member, directory):
        name = PurePosixPath(member.name)
        allowed = (base_root,) if base_root else ("tex", "fonts", "source", "hyph-utf8", "bin")
        if not name.parts or name.parts[0] not in allowed or ".." in name.parts:
            raise ValueError(f"Unexpected TeX archive path: {member.name}")
        return tarfile.data_filter(member, directory)

    with tarfile.open(path, "r:xz") as archive:
        members = (member for member in archive
                   if base_root or not member.name.startswith("tlpkg/"))
        archive.extractall(target, members=members, filter=safe)


def verified(root, bin_name, scratch):
    bin_path = root / "bin" / bin_name
    windows = os.name == "nt"
    env = {"PATH": os.pathsep.join([str(bin_path), "/usr/bin", "/bin"] if not windows else
                                  [str(bin_path), os.path.join(os.environ["SystemRoot"], "System32")]),
           "HOME": str(scratch), "TMPDIR": str(scratch), "LC_ALL": "C",
           "TEXMFVAR": str(scratch / "texmf-var"), "TEXMFCONFIG": str(scratch / "texmf-config")}
    if windows:
        env.update({key: os.environ[key] for key in ("SystemRoot", "ComSpec") if key in os.environ})
        env.update({"TEMP": str(scratch), "TMP": str(scratch), "USERPROFILE": str(scratch)})

    def executable(name):
        return bin_path / (name + ".exe" if windows else name)

    def invoke(*args):
        return subprocess.run([executable(args[0]), *args[1:]], cwd=scratch, env=env,
                              stdin=subprocess.DEVNULL, check=True, capture_output=True,
                              text=True, timeout=30).stdout

    if not all(os.access(executable(name), os.X_OK) for name in ("latex", "dvisvgm", "kpsewhich")):
        raise ValueError("The private TeX toolchain is incomplete.")
    invoke("latex", "--version")
    invoke("dvisvgm", "--version")
    needed = ("standalone.cls", "english.ldf", "amsmath.sty", "amssymb.sty", "xcolor.sty")
    found = invoke("kpsewhich", *needed).splitlines()
    if len(found) != len(needed) or not all(Path(path).resolve().is_relative_to(root.resolve()) for path in found):
        raise ValueError("The private TeX toolchain is missing MathTex packages.")
    return bin_path, env


@contextmanager
def install_lock(data):
    lock_fd = os.open(data / ".tex-setup.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(lock_fd, "r+b") as mutex:
        if os.name == "nt":
            import msvcrt

            while True:
                try:
                    msvcrt.locking(mutex.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as error:
                    if error.winerror not in (33, 36) and error.errno != 13:
                        raise
                    time.sleep(0.2)
        else:
            import fcntl

            fcntl.flock(mutex, fcntl.LOCK_EX)
        yield


def ensure_tex(data, lock, root, key, local):
    target = data / "tex"
    if target.is_symlink():
        raise ValueError("The private TeX directory must be a real directory.")
    with tempfile.TemporaryDirectory(prefix=".tex-setup-", dir=data) as folder:
        stage = Path(folder)
        marker = target / "manim-tex.lock"
        if target.exists():
            if not target.is_dir():
                raise ValueError("The private TeX location is occupied.")
            managed = marker.is_file() and not marker.is_symlink()
            if managed and marker.read_text().strip() != key:
                raise ValueError("The installed TeX lock differs. Keep the existing runtime until it is explicitly replaced.")
            try:
                print(verified(target, root["binary"], stage)[0])
                return
            except (ValueError, OSError, subprocess.SubprocessError):
                if not managed:
                    raise ValueError("An existing TeX directory could not be verified.")
        base = locked_archive(root, stage, local)
        base_root = ".TinyTeX" if root["platform"] == "linux-x64" else "TinyTeX"
        if os.name == "nt":
            # The pinned TinyTeX distribution uses the official R installer's SFX flags.
            subprocess.run([base, "-y", f"-o{stage}"], cwd=stage, check=True, timeout=120,
                           stdin=subprocess.DEVNULL, stdout=sys.stderr)
        else:
            extract(base, stage, base_root)
        candidate = stage / base_root
        architecture = "dvisvgm." + root["binary"]
        for spec in lock["overlays"]:
            name = spec["name"]
            if name.startswith("dvisvgm.") and name != architecture:
                continue
            archive = locked_archive(spec, stage, local)
            extract(archive, candidate if name == architecture else candidate / "texmf-dist")
        # Refresh the Kpathsea filename index without requiring a host Perl installation.
        tree = candidate / "texmf-dist"
        with (tree / "ls-R").open("w", encoding="utf-8", newline="\n") as output:
            output.write("% ls-R -- filename database for kpathsea; do not change this line.\n")
            for folder, directories, filenames in os.walk(tree):
                names = sorted([*directories, *filenames])
                relative = Path(folder).relative_to(tree).as_posix()
                output.write(f"\n./{relative if relative != '.' else ''}:\n")
                output.write("".join(name + "\n" for name in names))
        verified(candidate, root["binary"], stage)
        (candidate / "manim-tex.lock").write_text(key + "\n")
        previous = stage / "previous"
        try:
            if target.exists():
                target.rename(previous)
            candidate.rename(target)
            print(verified(target, root["binary"], stage)[0])
        except BaseException:
            if not candidate.exists() and target.is_dir():
                target.rename(candidate)
            if previous.exists():
                previous.rename(target)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("lock", type=Path)
    parser.add_argument("--archives", type=Path)
    options = parser.parse_args()
    data = options.data.resolve(strict=True)
    lock_bytes = options.lock.read_bytes()
    lock = json.loads(lock_bytes)
    key = hashlib.sha256(lock_bytes).hexdigest()
    system = {"Darwin": "darwin", "Linux": "linux-x64", "Windows": "win32-x64"}.get(platform.system())
    if system in ("linux-x64", "win32-x64") and platform.machine().lower() not in ("x86_64", "amd64"):
        system = None
    root = next((entry for entry in lock["roots"] if entry["platform"] == system), None)
    if root is None:
        raise ValueError("Private TeX setup is available on macOS and x86-64 Linux and Windows. Use local TeX Live on this platform.")
    with install_lock(data):
        ensure_tex(data, lock, root, key, options.archives)


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        main()
    except (ValueError, OSError, tarfile.TarError, subprocess.SubprocessError) as error:
        print(f"Private TeX setup failed: {error}", file=sys.stderr)
        sys.exit(1)
