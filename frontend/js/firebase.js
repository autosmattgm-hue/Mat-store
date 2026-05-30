import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCyX0lVUso_O1tdniqqqjw-72kjHZxXqd8',
  authDomain: 'mat-store-a8cb7.firebaseapp.com',
  projectId: 'mat-store-a8cb7',
  storageBucket: 'mat-store-a8cb7.firebasestorage.app',
  messagingSenderId: '641543429512',
  appId: '1:641543429512:web:a2ebd79d71304d4dab6e3d',
  measurementId: 'G-9WDH3M0PY9'
};

const app = initializeApp(firebaseConfig);

window.MATFirebase = {
  app,
  projectId: firebaseConfig.projectId,
  analyticsEnabled: false
};

isSupported()
  .then((supported) => {
    if (!supported) return;
    window.MATFirebase.analytics = getAnalytics(app);
    window.MATFirebase.analyticsEnabled = true;
  })
  .catch(() => {
    window.MATFirebase.analyticsEnabled = false;
  });
