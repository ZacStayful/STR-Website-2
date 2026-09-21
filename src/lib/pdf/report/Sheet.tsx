import React from "react";
import { Page, View } from "@react-pdf/renderer";
import { PAGE } from "../design/tokens";
import {
  RegistrationMarks, RunningHeader, PageFooter, sheetStyle, type ReportChrome,
} from "../design/Chrome";
import type { Nav } from "../sections";

/**
 * One sheet of the report.
 *
 * `wrap={false}` is load-bearing rather than cosmetic: page numbering counts
 * sections, so a page that quietly spilled onto a second sheet would disagree
 * with the contents strip on page one. These are fixed-composition layouts, so
 * not paginating is the correct behaviour. The setup page is the one exception
 * and opts back in — its line-item table is as long as the property needs.
 */
export function Sheet({
  chrome,
  nav,
  children,
  masthead,
  wrap = false,
  continued,
}: {
  chrome: ReportChrome;
  nav: Nav;
  children: React.ReactNode;
  /** Page one replaces the running header with the masthead. */
  masthead?: React.ReactNode;
  wrap?: boolean;
  continued?: boolean;
}) {
  return (
    <Page size="A4" style={sheetStyle} wrap={wrap}>
      <RegistrationMarks />
      {masthead ?? <RunningHeader chrome={chrome} nav={nav} />}
      <View style={{ flex: 1 }}>{children}</View>
      <PageFooter chrome={chrome} nav={nav} continued={continued} />
    </Page>
  );
}

export const CONTENT_W = PAGE.CONTENT;
