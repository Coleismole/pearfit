// Screen 2 of the design: Home. Check a catalog shirt before buying, or add a shirt you own.
import { CatalogSearch } from "../components/CatalogSearch.tsx";
import { TabScreen } from "../components/Screen.tsx";
import { link } from "../lib/router.ts";
import { useStore } from "../store.tsx";

export function Home() {
  const { wardrobe, planned } = useStore();
  return (
    <TabScreen active="home">
      <div className="row row--between">
        <h1 className="display display--brand">Pearfit</h1>
        <div className="row row--close">
          <a className="count-pill" href={link("wardrobe")}>
            {wardrobe.length} owned
          </a>
          <a className="count-pill count-pill--planned" href={link("wardrobe", "planned")}>
            {planned.length} planned
          </a>
        </div>
      </div>

      <div className="card card--roomy">
        <CatalogSearch label="Check something before you buy" hrefFor={(c) => link("check", c.id)} />
      </div>

      <section className="add-panel" aria-labelledby="add-panel-title">
        <div className="add-panel__eyebrow">Add to wardrobe</div>
        <div className="tag-frame" aria-hidden="true">
          <span className="tag-frame__corner tag-frame__corner--tl" />
          <span className="tag-frame__corner tag-frame__corner--tr" />
          <span className="tag-frame__corner tag-frame__corner--bl" />
          <span className="tag-frame__corner tag-frame__corner--br" />
          <span className="tag-frame__tag">
            <b>BRAND</b>
            <span>SKU · SIZE</span>
          </span>
        </div>
        <div className="stack stack--tight">
          <div className="add-panel__title" id="add-panel-title">
            Add the shirts you own
          </div>
          <div className="add-panel__text">Find one by the SKU on its tag, or type in its measurements.</div>
        </div>
        <div className="add-panel__actions">
          <a className="btn btn--lime" href={link("add")}>
            Find it in the catalog
          </a>
          <a className="btn btn--on-dark" href={link("add", "by-hand")}>
            Enter measurements
          </a>
        </div>
      </section>
    </TabScreen>
  );
}
