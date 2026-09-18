# D-MEX Mobile Prototype — Testing Guide

To test the new Flutter mobile prototype, you have three distinct options ranging from the easiest "zero-install" method to the fully native workflow. 

Because the Flutter SDK is not yet natively installed on your Windows PC, here is the exact roadmap to get the prototype rendering on your screen for your FYP:

## Option 1: The "Zero-Install" Web Sandbox (Fastest)
If you just want to see the UI rendering right this second without downloading anything, you can run the code entirely in your browser.
1. Go to an online Flutter IDE like **[Zapp.run](https://zapp.run/)** or **[DartPad.dev](https://dartpad.dev/)** (with Flutter enabled).
2. Grab the code from `dmex_mobile/lib/main.dart`, `app_theme.dart`, `bottom_nav.dart`, and `market_screen.dart` and paste them into the Sandbox.
3. The glassmorphic GameFi board will instantly render in a phone preview window right in your browser.

## Option 2: Run as a Desktop / Browser Web App (Recommended for FYP testing)
You don't actually need a heavy Android Emulator to test Flutter! Flutter natively compiles to Google Chrome or a Windows Desktop app.
1. Download the [Flutter SDK for Windows](https://docs.flutter.dev/get-started/install/windows) and add it to your System PATH variables.
2. Open this folder in VS Code (`C:\Users\USER\OneDrive\Documents\Desktop\FYP\D_MEX PROTOCOL\dmex_mobile`).
3. Open a new terminal and run `flutter pub get` to download the dependencies.
4. Run `flutter run -d chrome`.
5. The mobile app will pop up in a web browser window, perfectly simulating the mobile UI layout!

## Option 3: Full Native Android/iOS Emulator (For the Final Presentation)
If you want to record a video of the app running natively on an actual phone screen for your FYP presentation:
1. After installing Flutter, download **Android Studio** and set up a Virtual Device (Pixel 7 emulator).
2. Start the Virtual Device.
3. Open the `dmex_mobile` folder in VS Code, select the Android Emulator from the bottom right corner, and hit **F5** (or run `flutter run`).
4. The prototype will install directly onto the virtual phone where you can navigate the glassmorphic menus.

---
### Executing Smart Contract Swaps
Once the UI is running, we would finalize the `web3dart` integration. We would inject a testnet private key into the code so that when you hit the neon *Sign & Propose Swap* button, it instantly sends the transaction to the Scroll Sepolia network without needing MetaMask.
