// The app shell: providers, then one screen picked from the address. The routes are listed in README.md.
import { CatalogProvider } from "./catalog.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { Notice } from "./components/Messages.tsx";
import { link } from "./lib/router.ts";
import type { Route } from "./lib/router.ts";
import { GARMENT_TYPES } from "./lib/types.ts";
import type { GarmentType } from "./lib/types.ts";
import { Account } from "./screens/Account.tsx";
import { AddFound, AddFromCatalog } from "./screens/AddShirt.tsx";
import { Analysis } from "./screens/Analysis.tsx";
import { CompareItems, CompareNew } from "./screens/CompareScreens.tsx";
import { Home } from "./screens/Home.tsx";
import { OwnedItem, PlannedItemPage } from "./screens/ItemPages.tsx";
import { Onboarding } from "./screens/Onboarding.tsx";
import { ShirtForm } from "./screens/ShirtForm.tsx";
import { TypePage } from "./screens/TypePage.tsx";
import { Wardrobe } from "./screens/Wardrobe.tsx";
import { StoreProvider, useStore } from "./store.tsx";
import { useRoute } from "./useRoute.ts";

function asGarmentType(text: string | undefined): GarmentType | undefined {
  return GARMENT_TYPES.find((t) => t === text);
}

function Screen({ route }: { route: Route }) {
  const { wardrobe, onboarded } = useStore();
  const [first, second, third] = route.segments;
  const picking = route.query.pick === "1";
  const count = route.segments.length;

  // The first visit starts on the welcome screen.
  if (count === 0) return onboarded || wardrobe.length > 0 ? <Home /> : <Onboarding />;
  if (first === "welcome" && count === 1) return <Onboarding />;

  if (first === "wardrobe" && count === 1) return <Wardrobe tab="owned" />;
  if (first === "wardrobe" && second === "planned" && count === 2) return <Wardrobe tab="planned" />;
  if (first === "type" && count === 2) {
    const type = asGarmentType(second);
    if (type) return <TypePage type={type} />;
  }

  if (first === "add" && count === 1) return <AddFromCatalog />;
  if (first === "add" && second === "by-hand" && count === 2) return <ShirtForm startType={asGarmentType(route.query.type)} />;
  if (first === "add" && second === "item" && count === 3) return <AddFound candidateId={third} />;

  // key: a different shirt gets a fresh screen, so nothing typed or chosen for the last one is left over.
  if (first === "owned" && count === 2) return <OwnedItem key={second} id={second} picking={picking} />;
  if (first === "owned" && third === "edit" && count === 3) return <ShirtForm key={second} editId={second} />;
  if (first === "planned" && count === 2) return <PlannedItemPage key={second} candidateId={second} picking={picking} />;

  if (first === "check" && count === 2) return <Analysis key={second} candidateId={second} />;
  if (first === "check" && third === "compare" && count === 3) {
    return <CompareNew key={second} candidateId={second} size={route.query.size} withId={route.query.with} />;
  }
  if (first === "compare" && count === 1) return <CompareItems a={route.query.a} b={route.query.b} />;

  if (first === "account" && count === 1) return <Account />;

  return (
    <main className="screen">
      <Notice title="This page does not exist">
        <a className="btn btn--primary btn--small" href={link()}>
          Go to Home
        </a>
      </Notice>
    </main>
  );
}

export function App() {
  const route = useRoute();
  return (
    <StoreProvider>
      <CatalogProvider>
        <div className="app">
          {/* key: going to another screen clears a crash message, so Home and Back work after one. */}
          <ErrorBoundary key={route.segments.join("/")}>
            <Screen route={route} />
          </ErrorBoundary>
        </div>
      </CatalogProvider>
    </StoreProvider>
  );
}
