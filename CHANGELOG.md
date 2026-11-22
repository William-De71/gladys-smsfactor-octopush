# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- Gladys notifications by SMS through SMSFactor or Octopush, two French SMS gateways, to any operator: each user enters their mobile number in the "My account" block, the administrator the provider and its credentials once.
- Alert SMS (sent at any hour, without a "STOP" mention), with the sender of the account or a custom one; Unicode only when the text needs it; national numbers get the default country code.
- Scene triggers: SMS not sent (once per failure, never looping), SMS not delivered (SMSFactor delivery reports), SMS received (SMSFactor replies, with filters on the sender and the first word), credits low (credits or balance in euros).
- Scene actions: send an SMS to any number (even someone who is not a Gladys user), read the SMS account.
- Dashboard widgets: the SMS account (credits or balance, SMS of the month, sender, last failure) and the SMS replies.
- Configuration screen buttons: test the connection, send a test SMS.
- Cloud transport only; English, French, German and Spanish everywhere.
