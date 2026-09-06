import { MockGoalChips, MockMapPane, MockRankedList } from "./ProductMocks";

/** Browser-framed mock of the explorer used in the product page hero. */
export function ProductHeroVisual() {
  return (
    <div className="demo-frame mxp-frame">
      <div className="demo-chrome">
        <div className="demo-dots"><span /><span /><span /></div>
        <div className="demo-url">intelligence.stayful.co.uk/markets</div>
        <div className="demo-actions" />
      </div>
      <div className="demo-body mxp-frame-body">
        <MockGoalChips />
        <div className="mxp-frame-grid">
          <MockMapPane />
          <MockRankedList />
        </div>
      </div>
    </div>
  );
}
