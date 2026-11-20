# Signing the phone APK on GitHub
Add four repository secrets (Settings > Secrets and variables > Actions):
- KEYSTORE_BASE64 : contents of jarvis-release.keystore.base64.txt
- KEYSTORE_PASSWORD : the store password (see KEY-DETAILS-PRIVATE.txt)
- KEY_ALIAS : jarvis
- KEY_PASSWORD : the key password
Always use this same key so new versions install over the old one. Never commit the keystore.
