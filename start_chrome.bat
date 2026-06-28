@echo off
echo ===================================================
echo Spoustim Google Chrome s otevrenym portem 9222...
echo ===================================================
echo.
echo Prosim, nech tento prohlizec bezet a nic v nem neklikej, 
echo dokud neskonci skript Bazoše.
echo.

"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\\Google\\Chrome\\User Data"
