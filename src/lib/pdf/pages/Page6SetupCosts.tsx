import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbp } from "../components/Chrome";
import { H2, Subtitle, BASE_PAGE_STYLES } from "../components/Primitives";
import type { PdfSetupSnapshot } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  metaRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 14,
  },
  metaBox: {
    flex: 1,
    backgroundColor: C.MINT_GREEN + "55",
    borderRadius: 6,
    padding: 10,
  },
  metaLabel: {
    fontSize: 8,
    color: C.DARK_GREY,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
  },
  categoryTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 4,
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  thRow: {
    flexDirection: "row",
    backgroundColor: C.DARK_GREEN,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  thCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.WHITE },
  tdRow: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.CREAM,
  },
  tdCell: { fontSize: 8, color: C.DARK_GREY },
  tdCellBold: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.DARK_GREEN },
  cName: { flex: 4 },
  cSupplier: { flex: 2 },
  cQty: { flex: 1, textAlign: "right" },
  cUnit: { flex: 1.3, textAlign: "right" },
  cTotal: { flex: 1.6, textAlign: "right" },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 3,
    paddingHorizontal: 6,
    backgroundColor: C.CREAM,
  },
  subtotalText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
  },
  grandTotalBox: {
    marginTop: 14,
    backgroundColor: C.DARK_GREEN,
    borderRadius: 8,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  grandTotalLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.WHITE,
    letterSpacing: 1,
  },
  grandTotalValue: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: C.WHITE,
  },
});

export function Page6SetupCosts({ data }: { data: PdfSetupSnapshot }) {
  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />

      <H2>Property Setup Costs</H2>
      <Subtitle>
        Itemised estimate based on your property configuration. All figures
        inclusive. Supplier noted per item.
      </Subtitle>

      {/* Config meta */}
      <View style={s.metaRow}>
        <View style={s.metaBox}>
          <Text style={s.metaLabel}>Furnishing state</Text>
          <Text style={s.metaValue}>{data.furnishingLabel}</Text>
        </View>
        <View style={s.metaBox}>
          <Text style={s.metaLabel}>Bedrooms</Text>
          <Text style={s.metaValue}>{data.bedrooms}</Text>
        </View>
        <View style={s.metaBox}>
          <Text style={s.metaLabel}>Items included</Text>
          <Text style={s.metaValue}>{data.itemCount}</Text>
        </View>
      </View>

      {/* Line items grouped by category */}
      {data.categories.map((cat) => (
        <View key={cat.category}>
          <Text style={s.categoryTitle}>{cat.category}</Text>

          <View style={s.thRow}>
            <Text style={[s.thCell, s.cName]}>Item</Text>
            <Text style={[s.thCell, s.cSupplier]}>Supplier</Text>
            <Text style={[s.thCell, s.cQty]}>Qty</Text>
            <Text style={[s.thCell, s.cUnit]}>Unit £</Text>
            <Text style={[s.thCell, s.cTotal]}>Total</Text>
          </View>

          {cat.items.map((it) => (
            <View key={it.id} style={s.tdRow}>
              <Text style={[s.tdCell, s.cName]}>{it.name}</Text>
              <Text style={[s.tdCell, s.cSupplier]}>{it.supplier}</Text>
              <Text style={[s.tdCell, s.cQty]}>{it.qty}</Text>
              <Text style={[s.tdCell, s.cUnit]}>{formatGbp(it.unitCost)}</Text>
              <Text style={[s.tdCellBold, s.cTotal]}>{formatGbp(it.total)}</Text>
            </View>
          ))}

          <View style={s.subtotalRow}>
            <Text style={s.subtotalText}>Subtotal: {formatGbp(cat.subtotal)}</Text>
          </View>
        </View>
      ))}

      {/* Grand total */}
      <View style={s.grandTotalBox}>
        <Text style={s.grandTotalLabel}>GRAND TOTAL</Text>
        <Text style={s.grandTotalValue}>{formatGbp(data.grandTotal)}</Text>
      </View>
    </Page>
  );
}
