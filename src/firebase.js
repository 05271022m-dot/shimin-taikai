import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCipM_pzCcdPl8y3hdCtIv4lp_2I-gTRN8",
  authDomain: "simintaikai-2026.firebaseapp.com",
  projectId: "simintaikai-2026",
  storageBucket: "simintaikai-2026.firebasestorage.app",
  messagingSenderId: "495434452255",
  appId: "1:495434452255:web:cdc1a01acb3f92bcd7342a"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);