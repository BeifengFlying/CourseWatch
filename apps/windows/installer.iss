#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId={{160DBD38-9042-4A08-8A21-051D1F864DF4}
AppName=CourseWatch
AppVersion={#AppVersion}
AppPublisher=CourseWatch
DefaultDirName={localappdata}\Programs\CourseWatch
DefaultGroupName=CourseWatch
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
#ifdef ArtifactBase
OutputBaseFilename={#ArtifactBase}-setup
#else
OutputBaseFilename=CourseWatch-{#AppVersion}-build{#AppBuild}-win-x64-setup
#endif
SetupIconFile={#SourceDir}\CourseWatch.ico
UninstallDisplayIcon={app}\CourseWatch.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
LicenseFile={#SourceDir}\resources\TERMS.md
InfoBeforeFile={#SourceDir}\resources\DISCLAIMER.md

[Languages]
Name: "chinesesimplified"; MessagesFile: "installer\ChineseSimplified.isl"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Bootstrapper}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\CourseWatch"; Filename: "{app}\CourseWatch.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\CourseWatch"; Filename: "{app}\CourseWatch.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Run]
Filename: "{app}\CourseWatch.exe"; Description: "打开 CourseWatch"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\CourseWatch.exe"; Parameters: "--quit"; Flags: runhidden waituntilterminated; RunOnceId: "StopCourseWatch"
Filename: "{app}\CourseWatch.exe"; Parameters: "--unregister-notifications"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveCourseWatchNotifications"

[Code]
function NeedsWebView2: Boolean;
var Version: String;
begin
  Result := not ((RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
                 (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\CourseWatch.exe')) then
    if not Exec(ExpandConstant('{app}\CourseWatch.exe'), '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Result := '无法退出正在运行的 CourseWatch，请从托盘退出后重试。';
  if (Result = '') and NeedsWebView2 then begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then
      Result := '无法启动 WebView2 Runtime 安装程序，请安装 Microsoft Edge WebView2 Runtime 后重试。'
    else if NeedsWebView2 then
      Result := 'WebView2 Runtime 尚未安装。请确认网络连接，或自行安装 Microsoft Edge WebView2 Runtime 后重试。';
  end;
end;
