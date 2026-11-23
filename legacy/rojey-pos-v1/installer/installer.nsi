; Rojey POS installer: per-user install, shortcuts, and a normal Windows uninstaller.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APPNAME "Rojey POS"
!define EXENAME "Rojey POS.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RojeyPOS"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Rojey POS"
InstallDirRegKey HKCU "Software\RojeyPOS" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Rojey POS ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Rojey Creamery"
VIAddVersionKey "LegalCopyright" "Rojey Creamery"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Open Rojey POS now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function CloseApp
  ; Close a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /F /T /IM "${EXENAME}"'
  Pop $0
  Sleep 800
FunctionEnd

Function un.CloseApp
  nsExec::Exec 'taskkill /F /T /IM "${EXENAME}"'
  Pop $0
  Sleep 800
FunctionEnd

Section "Install"
  Call CloseApp
  SetOutPath "$INSTDIR"
  ; Remove the previous program files (not the saved data, which lives in %APPDATA%\Rojey POS).
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${APPDIR}\*.*"
  File "/oname=rojey.ico" "${ICON}"
  WriteUninstaller "$INSTDIR\Uninstall Rojey POS.exe"

  CreateShortcut "$DESKTOP\Rojey POS.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\rojey.ico" 0
  CreateDirectory "$SMPROGRAMS\Rojey POS"
  CreateShortcut "$SMPROGRAMS\Rojey POS\Rojey POS.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\rojey.ico" 0
  CreateShortcut "$SMPROGRAMS\Rojey POS\Uninstall Rojey POS.lnk" "$INSTDIR\Uninstall Rojey POS.exe"

  WriteRegStr HKCU "Software\RojeyPOS" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Rojey Creamery"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\rojey.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall Rojey POS.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall Rojey POS.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Call un.CloseApp
  Delete "$DESKTOP\Rojey POS.lnk"
  RMDir /r "$SMPROGRAMS\Rojey POS"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\RojeyPOS"

  ; Saved data holds settings, sign-ins and any orders not yet uploaded. Keep it unless asked.
  IfSilent keepdata
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
    "Also delete the saved data on this computer?$\r$\n$\r$\nThis removes settings, saved sign-ins and the local copy of the POS.$\r$\nANY ORDERS NOT YET UPLOADED WILL BE LOST.$\r$\n$\r$\nChoose No to keep it (recommended). It will be used again if you reinstall." \
    IDNO keepdata
  RMDir /r "$APPDATA\Rojey POS"
  keepdata:
SectionEnd
