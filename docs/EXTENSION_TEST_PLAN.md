# Manual Gmail test plan (the part automated tests cannot prove)
Automated tests use a FAKE Gmail page. Real Gmail may differ. Run these once in Chrome and report any FAIL.
Pixel opens cannot be tested with a localhost API (recipients' mail servers cannot reach it); link clicks and the document page can, from your own browser.

1. Load: chrome://extensions -> Developer mode -> Load unpacked -> select apps/extension/dist. Click the AfterSend icon: sign-in page opens.
2. Sign in (or create an account; confirm the email if Supabase asks).
3. Open Gmail, click Compose. EXPECT: a "Track this email" switch near the bottom toolbar. FAIL if absent (then tell Claude the Gmail layout; the fallback message should appear instead).
4. Switch it ON. EXPECT status: "On: set up when you click Send (not tracked yet)". It must NOT say tracked.
5. Send a test email to yourself with one https link in the body, clicking the Send button. EXPECT: brief delay, send happens, page toast "tracked and sent".
6. Repeat using Ctrl+Enter.
7. Open the received email: EXPECT the link still looks normal; hover shows your tracking address.
8. Click the link (works from your own browser with localhost). EXPECT redirect to the real page, then in the AfterSend app (Refresh): a "Link clicked" event.
9. Sign out in the app, then try sending with the switch ON. EXPECT "NOT tracked: Not signed in..." and NO email sent.
10. Switch OFF, send. EXPECT Gmail behaves normally, nothing registered.
11. Undo test: send with tracking ON and click Undo in Gmail's toast within 5s. EXPECT status "send was not confirmed" and no "Tracked and sent".
12. Notifications: Settings -> enable -> click a link in a new tracked email. EXPECT one Chrome notification within about a minute, none for repeats.
