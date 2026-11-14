<p align="center"><img src="docs/images/coursewatch-icon.png" alt="CourseWatch" width="144" height="144"></p>
<h1 align="center">CourseWatch</h1>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>
<p align="center">Course task management, personal schedules and deadline reminders. macOS 14+ / Windows 10+ x64.</p>
<p align="center">
  <a href="https://github.com/BeifengFlying/CourseWatch/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&amp;logoColor=white" alt="CI: GitHub Actions"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.2.32%20beta-orange" alt="Version: 0.2.32 beta"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Noncommercial-red" alt="License: CourseWatch Noncommercial License; commercial use prohibited"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-24-339933" alt="Node.js 24"></a>
  <a href="#installation"><img src="https://img.shields.io/badge/platform-macOS%2014%2B-blue" alt="Platform: macOS 14+"></a>
  <a href="docs/guides/WINDOWS.md"><img src="https://img.shields.io/badge/platform-Windows%2010%2B%20x64-blue" alt="Platform: Windows 10+ x64, device testing pending"></a>
</p>
<p align="center"><a href="#installation">Installation</a> · <a href="#features-and-demos">Demos</a> · <a href="#supported-platforms">Platforms</a> · <a href="#technology-stack">Technology</a> · <a href="#mac-performance-and-energy-measurements">Performance</a> · <a href="docs/guides/BUILD_HISTORY.md">Build history</a></p>

**Starting with build 32 (0.2.32), original material that the project has authority to license is for noncommercial use only. Commercial use is prohibited.** Lawfully obtained earlier versions remain subject to their original licenses; prior grants are not retroactively revoked. Old installer downloads have been removed. See [Section 8 of the Project Terms](TERMS.en.md#8-prohibition-of-commercial-use-and-redistribution) for scope and redistribution requirements.

CourseWatch is a course task manager for macOS and Windows. It consolidates homework, exams and deadlines from multiple learning platforms, checks selected courses locally, and sends reminders for new tasks and deadline changes. Personal schedules are available without a course account.

On macOS, closing the main window keeps the app in the menu bar. Windows offers a choice of hiding to the system tray or quitting. Task checks and reminders continue while the background service runs. Supported notification channels include desktop notifications, email, Web Push and iCloud Calendar.

![Native Mac desktop: example coursework, deadlines and task filters](docs/screenshots/desktop-build31/main-light.png)

## Installation

Current release: **0.2.32 (build 32, beta)**. Download the package for your system from [GitHub Releases](https://github.com/BeifengFlying/CourseWatch/releases/tag/v0.2.32):

| System | Download |
| --- | --- |
| macOS 14+ · Apple Silicon | [CourseWatch-0.2.32-build32-mac-arm64.dmg](https://github.com/BeifengFlying/CourseWatch/releases/download/v0.2.32/CourseWatch-0.2.32-build32-mac-arm64.dmg) |
| macOS 14+ · Intel | [CourseWatch-0.2.32-build32-mac-x64.dmg](https://github.com/BeifengFlying/CourseWatch/releases/download/v0.2.32/CourseWatch-0.2.32-build32-mac-x64.dmg) |
| Windows 10+ · x64 | [Build from source on Windows](docs/guides/WINDOWS.md) |

The minimum Windows version is Windows 10 version 2004 (build 19041); version 22H2 or later is recommended. The current source produces `CourseWatch-0.2.32-build32-win-x64-setup.exe`, a ZIP with the same prefix, and `.sha256` files. Check [Windows Actions](https://github.com/BeifengFlying/CourseWatch/actions/workflows/windows.yml) for a successful run containing these changes; downloads depend on that run's actual artifacts. Native window checks for 0.2.30 r2 ran on Windows 11 at 150% scaling. Windows 10, full installation / upgrade / removal, and real notifications still need testing. See the [0.2.31 merge checks](docs/verification/WINDOWS-0.2.31-MERGE.md) for the merged source.

On Mac, open the DMG and drag CourseWatch into Applications. To upgrade, quit the old version from the menu bar before replacing it. Upgrades retain the existing data directory. Back up important data before replacing the application. Updates are installed manually. Packages and checksums from before the noncommercial license are retained in a local archive; their GitHub downloads are removed.

**Packages do not include a browser.** Install [Chrome](https://www.google.com/chrome/) or [Edge](https://www.microsoft.com/edge) before connecting a learning platform, and select Automatic, Chrome or Edge in Settings → General. If the selected browser is unavailable, the application prompts for installation or a different selection. CourseWatch uses a separate browser profile. Personal schedules and local reminders work without a browser.

Each package has a matching `.sha256` file. Compare it with the output of:

```sh
shasum -a 256 CourseWatch-0.2.32-build32-mac-arm64.dmg
```

Mac packages are ad hoc signed and have not been notarized by Apple. The Intel package has passed architecture and Rosetta runtime checks; its interface has not been checked on a physical Intel Mac. Platform coverage and reminder delivery may be incomplete during the beta. School, instructor and platform notices remain the authoritative sources. See [beta limitations](DISCLAIMER.md) for details. The application interface and most documentation are currently in Chinese; this language switch applies to the README.

## Features and demos

Desktop images are actual captures of the native Mac application using a separate data directory. Courses, tasks, schedules and model output are fictional; no real accounts or course data are shown. The surrounding wallpaper is macOS 27 Golden Gate. Desktop widgets, the system menu bar and Dock are outside the frame. The email image shows test messages received on a phone. See the [capture sources and record](docs/verification/README-DESKTOP-2026-11-15.md).

### Course selection and task lists

Sign in, select the courses you want to synchronize and save. Filter tasks by course, type or completion status. Removing and adding a course again preserves personal flags. Courses with identical names are distinguished by their platform course/class IDs, and courses with no tasks stay in the list.

Tasks already overdue on the first sync do not trigger retrospective reminders. New tasks and later deadline changes follow your reminder settings.

![Course management: select, remove and add example courses](docs/screenshots/desktop-build31/courses-light.png)

### Chaoxing completion status

Build 30 adds a **green check and completion text** for completed chapters, videos and chapter quizzes in both light and dark themes. Video and quiz completion are tracked independently. Completing a video does not change its quiz status; unknown states retain their labels.

Expand chapter groups, choose a starting point, resume the last chapter or tab, or switch chapters while paused. Official task counts, chapter completion and video position are shown separately.

### Playback and study controls

Chaoxing and Unipus have separate settings, with experimental features off by default. Playback, keeping a page open and background keepalive do not require a model. To generate answers, configure an endpoint, model ID and API key. Model settings can fetch the model list and test the connection; during a run, you can view reasoning and answers returned by the endpoint.

![Study controls, chapter directory and model output](docs/screenshots/desktop-build31/study-chaoxing-light.png)

<details>
<summary>Dark theme: study controls and completion status</summary>

![Dark theme with example chapters and separate video and quiz completion](docs/screenshots/desktop-build31/study-chaoxing-dark.png)

</details>

Chaoxing provides a setting for handling chapter quizzes during playback. Automatic filling and submission for chapter practice must be enabled separately. Course homework only generates answers; exams and assessments are excluded. Obfuscated question fonts are decoded locally. Unreadable content pauses the task, and an uncertain submission result stops retries.

Unipus runs in a headless browser by default, sends keepalive activity every five minutes and continues through ordinary inactivity prompts. “Open running window” pauses the task and switches to a visible browser; resuming returns it to the background. Pausing stops keepalive activity. Switching reloads the official page, so save any manual input first. Identity verification requires manual action. Credited study time is determined by the platform.

![Unipus: example tutorial, playback position and chapter directory](docs/screenshots/desktop-build31/study-unipus-light.png)

### Email, Web Push and iCloud Calendar

Notification channels are configured separately in Settings → Mobile notifications:

| Channel | Setup |
| --- | --- |
| Email | Use different sender and recipient mailboxes; supports TLS on port 465 and STARTTLS on 587 |
| Web Push | Host an HTTPS subscription page and pair your device; iPhone/iPad requires iOS 16.4+ and authorization through a Home Screen web app |
| iCloud Calendar | Authorize a dedicated calendar on Mac and enable calendar sync under the same Apple account; sync is currently one-way |

![Mobile notification settings](docs/screenshots/desktop-build31/settings-mobile-light.png)

<details>
<summary>Web Push and iCloud Calendar settings</summary>

![Web Push and iCloud Calendar settings without connected devices or calendars](docs/screenshots/desktop-build31/settings-calendar-light.png)

</details>

Mobile inbox showing two received simulated test emails (recipient redacted):

<img src="docs/screenshots/mail-test-mobile.jpg" alt="Two CourseWatch test emails received in a mobile inbox, recipient hidden" width="400">

Email and Web Push need the computer to stay awake and online. No new messages are sent while it is asleep or powered off. Events already synced to iCloud can still trigger phone calendar reminders. Delivery delays depend on mail providers, connectivity and system settings; Web Push and cross-device iCloud delivery still need device testing. See the [mobile notification guide](docs/guides/MOBILE_NOTIFICATIONS.md) for setup.

### Menu bar and personal schedules

Closing the main window leaves task checks and reminders running. Choose Quit from the menu bar or tray to stop them. The Mac menu bar previews up to six pending items and provides study progress, pause, resume and chapter controls.

<img src="docs/screenshots/desktop-build31/native-preview-light.png" alt="Menu bar tasks and study controls for two platforms; native view with example data" width="390">

Personal schedules support notes, stars, completion and undo, plus multiple advance reminders. Personal completion marks organize your list locally; they do not submit tasks to a learning platform.

![Personal schedules with example events, stars and deadline reminders](docs/screenshots/desktop-build31/schedules-light.png)

<details>
<summary>Schedule form and per-item reminders</summary>

![Adding an example schedule: title, date, time, notes and reminders](docs/screenshots/desktop-build31/schedule-editor-light.png)

![Per-item advance reminder settings](docs/screenshots/desktop-build31/reminder-editor-light.png)

</details>

Settings are grouped into General, Reminders, Mobile notifications, Study and Data. General and reminder settings save automatically. System diagnostics can be exported from run details or the check log, including after a restart. Exports exclude login credentials, model keys, question text and raw pages.

### Windows layout and appearance

Windows shares the course, study and settings pages with macOS. General settings offer System, Light and Dark themes and save the selection. The previous Windows appearance setting is carried over to the shared theme field.

The main window is fixed at 1060×720 and platform windows at 660×700, adjusted for system scaling and reduced when the work area is smaller. Windows can be moved; minimize and close buttons are adjacent. Maximizing and edge resizing are disabled. The settings panel is fixed at 680×600px within the available space, with scrolling content.

The sidebar and content pane have separate rounded corners. Outer margins and the gap between panes show the desktop, with no full-window backing plate or white border. On first launch, Windows asks about background operation and startup at sign-in; startup is off by default. On first close, it asks whether to hide to the tray or quit, with an option to remember the choice. Hiding retains reminders; quitting stops the background service.

The following images are from the 0.2.30 r2 native window checks, with a blue test background and fictional courses. The merged 0.2.31 source uses the current default accent and shared theme control.

![Light Windows window boundaries, 0.2.30 r2 check](docs/screenshots/windows30-r2-exterior-light.png)

![Dark Windows window boundaries, 0.2.30 r2 check](docs/screenshots/windows30-r2-exterior-dark.png)

### Settings and notification history

General settings provide theme, accent color, browser and check frequency. Reminder settings control system notifications and default advance reminders. The Data page provides task export, backups and local simulation.

![General settings: appearance, browser and check frequency](docs/screenshots/desktop-build31/settings-general-light.png)

<details>
<summary>Reminders, study, data and notification pages</summary>

![System notifications and default reminder settings](docs/screenshots/desktop-build31/settings-reminders-light.png)

![Study settings with independent platform switches](docs/screenshots/desktop-build31/settings-study-light.png)

![Data settings: task export, backups and local simulation](docs/screenshots/desktop-build31/settings-data-light.png)

![Notification history with example course tasks](docs/screenshots/desktop-build31/notifications-light.png)

</details>

## Supported platforms

| Platform | Current features |
| --- | --- |
| Yunnan university computer proficiency examination system (jsjks) | Homework and exam lists for configured classes |
| PMPH medical education question bank | Homework and exam lists |
| Standard Yuketang (www.yuketang.cn) | Course lists, paginated activity homework and quizzes, official exam-type matching |
| Chaoxing Xuexitong | Course selection, homework and exam sync, task dates, chapter and official progress queries, experimental study controls |
| Unipus AI | Tutorial shelf, homework and exam summaries, separate study controls; tasks without an associated tutorial appear separately |

Current maintenance focuses on the desktop application and the listed platforms. Daomeng was removed in build 15. The browser extension source remains in the repository.

Only selected courses are synchronized. An expired login or manual verification pauses the relevant platform. Failed requests are not treated as empty task lists, and partial sync failures do not remove existing tasks. Coverage varies between institutions, courses and question types. Specific fixes and test records are linked in the [build history](docs/guides/BUILD_HISTORY.md).

## Mac performance and energy measurements

Build 30 idle resource use was measured on **2026-11-14**, using a **MacBook Pro with M1 Max, 32 GiB RAM and macOS 15.7.4**. The isolated test copy used production code with 100 example schedules and normal reminder timers, without course accounts or model requests. Each state had a 15-second warm-up and 120 seconds of measurements at two-second intervals. Totals include the native shell, Node and attributed WebKit helpers.

| State | Mean CPU | Mean RSS | Mean physical footprint | Processes |
| --- | ---: | ---: | ---: | ---: |
| Foreground idle | 0.022% | 302.7 MiB | 169.3 MiB | 5 |
| Minimized | 0.015% | 183.2 MiB | 76.3 MiB | 2–3 |
| Main window closed | 0.015% | 167.5 MiB | 70.1 MiB | 2 |

CPU 100% represents one logical core. Summed RSS may count shared pages more than once. The table covers idle operation without course accounts. Additional resource use from course synchronization, browsers and study tasks is outside this measurement.

Minimizing or hiding the window saves drafts and releases the WebView. Reminders continue after closing a macOS window or hiding a Windows window to the tray; choosing Quit on Windows stops the background service. An inactive window stops UI polling. Translucency is off by default. Browsers start as needed and close when their managed work finishes normally. The app does not prevent system sleep.

A separate `powermetrics` run collected 83 samples over about seven minutes. Estimated system CPU + GPU + ANE power averaged **2.39 W**, ranging from **1.81 to 3.48 W**. The figures represent system chip power and include other applications and concurrent study tasks. App-only power consumption and battery life have not had a controlled comparison.

[Full method and results](docs/verification/MACOS-PERFORMANCE-2026-11-14.md) · [CPU/memory data](docs/verification/macos-performance-2026-11-14.json) · [Chip power data](docs/verification/macos-power-2026-11-14.json)

## Build history

The [build history](docs/guides/BUILD_HISTORY.md) lists feature additions, platform changes and fixes. Original entries remain in [CHANGELOG](CHANGELOG.md).

Early version strings and build numbers were separate: builds 1–27 mostly kept older version strings, and `0.2.<build number>` began with build 28. Use build numbers when looking up earlier changes. Separate records for builds 1–4 are missing and noted in the table; most builds 9–29 were local updates.

## Technology stack

| Component | Technology |
| --- | --- |
| Interface | Vue 3, TypeScript 6, Vite 8, Lucide; Naive UI in the extension interface |
| Local service | Node.js 24, Fastify 5, Zod 4 |
| Storage | SQLite, better-sqlite3 |
| Platform parsing and browser control | Playwright, Cheerio; locally installed Chrome / Edge |
| Mac shell | Swift, AppKit, WKWebView, UserNotifications, EventKit |
| Windows shell and installer | C#, .NET 10, WinForms, WebView2, Inno Setup 6 |
| Browser extension | WXT, Vue |
| Notifications | Nodemailer (SMTP), web-push, node-notifier, QR code pairing |
| Checks and tests | vue-tsc, Vitest, Playwright |

## Development and packaging

Both desktop apps share a Vue interface and Node / SQLite backend. Mac uses an AppKit / WKWebView shell; Windows uses WinForms / WebView2.

Requires Node.js 24. Mac packaging also needs Xcode Command Line Tools. Runtime checks for Intel cross-builds need Rosetta.

```sh
npm ci
npm run browser:install       # Development tests only; never bundled
npm run typecheck
npm test -- --maxWorkers=2
npm run build:mac:all         # Apple Silicon + Intel
```

Windows needs .NET 10 SDK, Inno Setup 6 and an installed Chrome or Edge. See the [Windows build guide](docs/guides/WINDOWS.md).

```powershell
git pull origin main
npm ci
npm run build:win
```

Packaging checks pinned upstream files and [protected study logic](docs/guides/STUDY_PROTECTED_LOGIC.md). Package names include version and build number; existing packages and checksums are not overwritten. Generated `build/`, `dist/` and `.cache/` directories stay outside Git.

Local data directories:

- macOS: `~/Library/Application Support/CourseWatch/`
- Windows: `%LOCALAPPDATA%\CourseWatch`

Session snapshots and notification secrets use OS credential protection. The database and browser profiles are not encrypted as a whole. Task exports exclude login sessions; read the [privacy and data notes](PRIVACY.md) before backing up or migrating. More details are in the [documentation index](docs/README.md) and [script guide](scripts/README.md).

## Feedback and licensing

Report problems in [Issues](https://github.com/BeifengFlying/CourseWatch/issues), including the version and build number, system, learning platform and reproduction steps. Include redacted screenshots for page-specific issues. Do not publish accounts, cookies, databases or browser profiles. Review and redact logs before uploading.

**Commercial use is prohibited, including paid distribution, paid services and integration into paid products.** Starting with 0.2.32, original material in new releases that the project has authority to license uses the [CourseWatch Noncommercial License 1.0](LICENSE); see the [Project Terms](TERMS.en.md) for use requirements. This is a custom noncommercial license, not an open-source license as defined by the OSI. Earlier Apache-2.0 grants are not retroactively revoked, including when old installers are removed. The beta is free. Advertising partnerships and donations are not accepted. Sources for third-party code, platform names and icons are listed in [third-party notices](THIRD_PARTY_NOTICES.md). Outstanding dependency license items are recorded in the [license review](docs/legal/RELEASE_LICENSE_REVIEW.md).
