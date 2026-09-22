# Installing and living with it

The short version is in the [README](../README.md): download the installer,
run it, make an account. This is the longer version — where things are kept,
how to move a career to another PC, and what to do when something does not
work.

---

## Installing

Download **`Endurance Racing Career Setup <version>.exe`** from the
[Releases](../../releases) page and run it.

The installer asks nothing difficult. It installs for you rather than for the
whole machine, which is why it never asks for an administrator password, and
it offers to change the install folder if you want it somewhere other than the
default. You get a Start-menu entry and a desktop shortcut.

### "Windows protected your PC"

Expect this. The installer is not code-signed, and Windows says so about every
unsigned installer it has not seen before, whatever is inside it. **More info →
Run anyway** proceeds; closing the box does not.

A signing certificate is a recurring cost for a personal project, so this is
unlikely to change. If you would rather not run unsigned software — a
perfectly sensible position — you can run the application from the source
instead; the README explains how.

### The portable build

`Endurance Racing Career <version> portable.exe` runs without installing
anything: no Start-menu entry, no uninstaller, nothing written outside your
user profile. It is the same application, and it keeps its career in the same
place, so you can move between the two freely.

---

## First run

The application opens on a **Welcome** screen, because there are no accounts
yet. Give the account a name — whatever you would like the card to say — pick
an avatar and an accent colour, and you are in.

A password is optional. Set one if somebody else uses this PC and you would
rather they did not open your career by clicking on it. You can add, change or
remove it later from **Settings**, and you will be asked for the current one
before it changes.

There is no password recovery. Nothing here can email you, and there is no
server that knows anything about you. If you forget the password, the career is
still on the disk and still readable with other tools, but the application will
not open it for you.

### Adding another account

**Career → Switch account…**, or the account control at the bottom of the
navigation, then **New account** on the picker. Every account is a completely
separate career: its own races, hours, XP, levels, achievements, collections,
mastery and statistics. Nothing is shared and nothing is visible across them.

---

## Where your career is kept

```
%APPDATA%\Endurance Racing Career\
  data\endurance.db          every account on this PC, in one file
  data\endurance.db-wal      SQLite's write-ahead log — part of the database
  data\endurance.db-shm
  logs\main.log              what start-up did, and anything that went wrong
  backups\                   where "Back up career…" offers to save
```

Paste `%APPDATA%\Endurance Racing Career` into the Explorer address bar to get
there, or use **Career → Open data folder**.

### Backing up

Use **Career → Back up career…**. It writes a single `.db` file wherever you
point it, and it is safe to do while the application is running and while a
stint is being logged.

Copying `endurance.db` by hand while the application is open is *not* safe.
SQLite keeps recent writes in the `-wal` file beside it, so a copy of the `.db`
alone can be missing the last thing you did. Either use the menu item, or close
the application first and copy all three files together.

A backup is an ordinary database file. To restore one, close the application,
put it in the data folder as `endurance.db` (deleting any `-wal` and `-shm`
files beside it), and start the application again.

### Moving to another PC

Install the application there, then restore a backup as above. Everything
travels: every account, every race, every logged stint, the whole XP ledger.

### Uninstalling

Uninstalling removes the application and leaves
`%APPDATA%\Endurance Racing Career` exactly where it is. That is deliberate —
an uninstall must never delete someone's viewing history. Reinstall later and
your career is still there.

If you genuinely want it gone, delete that folder yourself, after taking a
backup you are sure about.

---

## When something does not work

The application writes what it did on start-up to
`%APPDATA%\Endurance Racing Career\logs\main.log`, and every error window it
shows has a button that opens that folder. That file is the first thing to
look at, and the thing to quote if you ask for help.

**It shows an error window instead of starting.** The message says which step
failed — preparing the database, starting the server, waiting for it to
answer. The log has the detail underneath it.

**It sits on the splash screen for a long time.** The first launch after an
update can take a few seconds longer while migrations run. If it never
finishes, the log will say what it was waiting for.

**Nothing happens when I open it a second time.** Only one copy runs at a
time; a second launch brings the existing window to the front instead of
opening another. If no window appears, one may be off-screen — see below.

**The window is somewhere I cannot reach it.** The application checks a
remembered position against the monitors you have now and centres itself if it
no longer fits, so this should not happen. If it does, close the application
and delete `%APPDATA%\Endurance Racing Career\window-state.json`; the next
launch starts from a centred default.

**My antivirus is unhappy.** Unsigned installers that unpack an application and
open a local network port attract that. The port is bound to `127.0.0.1` and is
not reachable from anywhere else on the network; there are no outbound
connections at all.

**I have forgotten an account's password.** There is no way to recover it from
inside the application, and no way to have one sent to you. Another account on
the same PC cannot open it either.
