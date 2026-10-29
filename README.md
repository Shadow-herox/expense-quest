# ExpenseQuest

A gamified personal-finance tracker. Log expenses, earn XP and level up, complete savings quests and unlock achievements, with charts of your spending.

## Features

- Expense logging with charts (Chart.js)
- XP, levels, quests and achievements
- Google sign-in with data stored in Firebase (Firestore + Storage for receipts)

## Setup

1. Create a Firebase project and enable **Authentication (Google)**, **Firestore** and **Storage**.
2. Put your project's web config in `firebase-config.js`.
3. Deploy the security rules in `firestore.rules` and `storage.rules`.
4. Serve the folder over HTTP (ES modules don't load from `file://`):

```bash
npx serve .
```

Then open `expense-quest.html`.

## Built with

HTML, CSS, vanilla JavaScript (ES modules), Firebase, Chart.js
