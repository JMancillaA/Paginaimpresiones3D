import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAsrn4S679EWsvF0QLx1psrIEWu6Bnl0_0",
  authDomain: "whiskerworks3d-31bf4.firebaseapp.com",
  projectId: "whiskerworks3d-31bf4",
  messagingSenderId: "141225871382",
  appId: "1:141225871382:web:97a0f61a2eafbdedf3cd37",
  measurementId: "G-56BZ1PDE1P"
};

export const ARTICULOS_COLLECTION = "articulos";

export function getFirebaseApp() {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

export async function startAnalytics(app = getFirebaseApp()) {
  try {
    if (await isSupported()) {
      getAnalytics(app);
    }
  } catch (error) {
    console.warn("Firebase Analytics no esta disponible en este entorno.", error);
  }
}
