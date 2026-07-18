# What is this?
This is document with rules for what Paradise Interface design should follow. It's highly preferred to not break them.

Specifics need to also be read through trello roadmap page: https://trello.com/b/ZQVstPXp/paradise-roadmap

Most of interfaces must look as close as possible to reference_ images.

Required fonts:
- Segoe UI font family
- Helvetica Rounded (logo font)

No half-rounded corners for buttons or other elements. It's either a square shape or fully round.

tab_indicator.svg must be used for tabs in Direct Messages under MESSAGES . REQUESTS

Messages
Your sent message color must be #E5F7FD
Other's messages color must be #C7EDFC
Shape and visuals example at ./Assets/reference_message.png

Your profile
./Assets/sky_banned.svg must be in profile section at the left top. Like in ./Assets/reference_profile.png is shown.
Quick actions buttons are bound to right side of the panel

Entire panel color must be #F0FAFC with edges of #E7F1F3

User status preferably should be taken from ./Assets/user_status/[name].svg

Other's profile and chat overview (reference_userprofile.png) must include attachments from the chat as a gallery grid (similar to Telegram), if no attachments are in the chat, the category for media must not be showcased.
Same goes to number, which is a phone number you set in profile settings and decide whether you want it to be shown or not (if not shown - no text in overview panel)

Download & Update button next to window actions should only show up when new release is out on this github repository (clicking it will download and patch the existing Paradise app into newer release version)

When hovering over the message, it will show button with 3 dots that would open context menu regarding the message(which can also be opened by RMB on message)
It would include:
- React with emoji[1] (works same way Discord or Telegram does)
- Reply
- Edit(if your own message)
- Copy Text (copies message contents)
- Copy Raw (copies raw message contents including markdown, etc etc)
- Forward (opens a popup where you select who you want to forward message to . **will send a system message in DM alerting that you have forwarded their message**)
- Delete (if yours or if you have permission to on a server . colored to red unlike other buttons)
It would also show a quick little emoji icon under the message, indicating you can react on it with emoji[1]