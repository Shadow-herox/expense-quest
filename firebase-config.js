/**
 * Replace with your Firebase project config (Project settings → Your apps).
 * Enable: Authentication (Google), Firestore, Storage.
 *
 * Firestore (example rules):
 *   users/{userId} → read: any signed-in user; write: owner only
 *   users/{userId}/receipts/{id} → read/write: owner only
 *   quests/{id} → read/write: owner (resource.data.userId == auth.uid)
 *
 * Storage: receipts/{userId}/** → read/write if auth.uid == userId
 *
 * Open the app over HTTP (e.g. npx serve) so ES modules load; file:// often blocks imports.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyDWcexay-0YU8YVO6Zc06Zp294zSV_3GO8',
  authDomain: 'expense-quest-dfc9a.firebaseapp.com',
  projectId: 'expense-quest-dfc9a',
  storageBucket: 'expense-quest-dfc9a.firebasestorage.app',
  messagingSenderId: '188426628347',
  appId: '1:188426628347:web:7fd8c479b43d5fc4f1d45e',
  measurementId: 'G-B4NXZ1N8JJ',
};
