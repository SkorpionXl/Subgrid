; SubGrid Studio – per-user installer (no admin rights needed)
; build:  makensis -DVERSION=2.2.0 -DEXE=../build/SubGrid.exe -DOUT=../dist/SubGrid-Studio-Setup.exe subgrid-studio.nsi
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "2.2.0"
!endif
!ifndef EXE
  !define EXE "../build/SubGrid.exe"
!endif
!ifndef OUT
  !define OUT "../dist/SubGrid-Studio-Setup.exe"
!endif
!define APP "SubGrid Studio"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SubGridStudio"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\SubGrid Studio"
InstallDirRegKey HKCU "Software\SubGrid\Studio" "InstallDir"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1031 "ProductName" "${APP}"
VIAddVersionKey /LANG=1031 "FileDescription" "${APP} Setup"
VIAddVersionKey /LANG=1031 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1031 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1031 "LegalCopyright" "Ben, 2026"

!define MUI_ICON "subgrid.ico"
!define MUI_UNICON "subgrid.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Subwoofer-Arrays planen, Zonen und Wände zeichnen, Optimierer mit Vorwissen.$\r$\n$\r$\nInstalliert nur für deinen Benutzer – keine Admin-Rechte nötig.$\r$\n$\r$\nWeiter zum Installieren."
!define MUI_FINISHPAGE_RUN "$INSTDIR\SubGrid.exe"
!define MUI_FINISHPAGE_RUN_TEXT "${APP} jetzt starten"
!define MUI_COMPONENTSPAGE_NODESC

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Section "SubGrid Studio" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; a running instance would lock the exe
  nsExec::Exec 'taskkill /IM SubGrid.exe /F'
  File "/oname=SubGrid.exe" "${EXE}"
  File "subgrid.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\SubGrid"
  CreateShortcut "$SMPROGRAMS\SubGrid\${APP}.lnk" "$INSTDIR\SubGrid.exe" "" "$INSTDIR\subgrid.ico"
  CreateShortcut "$SMPROGRAMS\SubGrid\${APP} (im Browser).lnk" "$INSTDIR\SubGrid.exe" "--browser" "$INSTDIR\subgrid.ico"
  CreateShortcut "$SMPROGRAMS\SubGrid\${APP} deinstallieren.lnk" "$INSTDIR\Uninstall.exe"

  ; .subgrid projects open with a double-click
  WriteRegStr HKCU "Software\Classes\.subgrid" "" "SubGrid.Project"
  WriteRegStr HKCU "Software\Classes\SubGrid.Project" "" "SubGrid-Projekt"
  WriteRegStr HKCU "Software\Classes\SubGrid.Project\DefaultIcon" "" "$INSTDIR\subgrid.ico"
  WriteRegStr HKCU "Software\Classes\SubGrid.Project\shell\open\command" "" '"$INSTDIR\SubGrid.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  WriteRegStr HKCU "Software\SubGrid\Studio" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Ben"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\subgrid.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" $0
SectionEnd

Section "Verknüpfung auf dem Desktop" SecDesk
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\SubGrid.exe" "" "$INSTDIR\subgrid.ico"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM SubGrid.exe /F'
  Delete "$INSTDIR\SubGrid.exe"
  Delete "$INSTDIR\subgrid.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\SubGrid\${APP}.lnk"
  Delete "$SMPROGRAMS\SubGrid\${APP} (im Browser).lnk"
  Delete "$SMPROGRAMS\SubGrid\${APP} deinstallieren.lnk"
  RMDir "$SMPROGRAMS\SubGrid"
  Delete "$DESKTOP\${APP}.lnk"
  ReadRegStr $0 HKCU "Software\Classes\SubGrid.Project\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\SubGrid.exe" "%1"' 0 +3
    DeleteRegKey HKCU "Software\Classes\SubGrid.Project"
    DeleteRegKey HKCU "Software\Classes\.subgrid"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\SubGrid\Studio"
  MessageBox MB_YESNO|MB_ICONQUESTION "Auch die gespeicherten Einstellungen und das zuletzt offene Projekt löschen?$\r$\n($LOCALAPPDATA\SubGrid)$\r$\n$\r$\nDeine .subgrid-Projektdateien bleiben in jedem Fall erhalten." /SD IDNO IDNO keep
    RMDir /r "$LOCALAPPDATA\SubGrid"
  keep:
SectionEnd
