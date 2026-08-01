import { ClerkProvider, useAuth } from "@clerk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type AppAuth } from "./App";
import "./styles.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ClerkApp() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const auth: AppAuth = {
    enabled: true,
    loaded: isLoaded,
    signedIn: Boolean(isSignedIn),
    getToken,
  };
  return <App auth={auth} />;
}

const application = clerkPublishableKey ? (
  <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
    <ClerkApp />
  </ClerkProvider>
) : <App />;

createRoot(document.getElementById("root")!).render(<StrictMode>{application}</StrictMode>);
