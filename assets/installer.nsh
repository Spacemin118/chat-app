; Nova Star talks straight to the other computers on the LAN, so Windows
; Firewall has to allow the discovery broadcast and the peer link ports.
; Without these rules the app installs fine but never finds anyone.

!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Nova Star discovery"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Nova Star peer link"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Nova Star discovery" dir=in action=allow protocol=UDP localport=41234 profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Nova Star peer link" dir=in action=allow protocol=TCP localport=41235-41254 profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Nova Star discovery"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Nova Star peer link"'
!macroend
