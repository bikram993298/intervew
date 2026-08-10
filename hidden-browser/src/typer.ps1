Add-Type -AssemblyName System.Windows.Forms
while ($true) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq 'EXIT') { break }
    if ($line.StartsWith('CHAR:')) {
        $b64 = $line.Substring(5)
        $ch = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
        [System.Windows.Forms.SendKeys]::SendWait($ch)
    }
}
