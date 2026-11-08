; Extra text for the Jarvis installer (electron-builder NSIS include)
!macro customHeader
  BrandingText "J.A.R.V.I.S  -  by Suchock"
!macroend

; A real uninstall removes every trace (keys, settings, pairing, start-up entry) so the next person on this PC starts empty.
; An update runs the old uninstaller with the "updated" flag, so nothing is removed then.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Jarvis"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.suchock.jarvis.pc"
    RMDir /r "$APPDATA\Jarvis"
    RMDir /r "$LOCALAPPDATA\Jarvis"
    RMDir /r "$APPDATA\jarvis-pc"
    RMDir /r "$LOCALAPPDATA\jarvis-pc-updater"
  ${endIf}
!macroend
