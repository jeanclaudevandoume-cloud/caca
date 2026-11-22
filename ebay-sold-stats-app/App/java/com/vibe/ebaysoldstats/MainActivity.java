package com.vibe.ebaysoldstats;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Build;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ScrollView;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final String[][] SITES = {
            {"eBay US  (USD $)", "www.ebay.com"},
            {"eBay UK  (GBP \u00a3)", "www.ebay.co.uk"},
            {"eBay FR  (EUR \u20ac)", "www.ebay.fr"},
            {"eBay DE  (EUR \u20ac)", "www.ebay.de"},
            {"eBay ES  (EUR \u20ac)", "www.ebay.es"},
            {"eBay IT  (EUR \u20ac)", "www.ebay.it"},
    };

    private WebView wv;
    private EditText queryInput;
    private Spinner siteSpinner;
    private TextView status, result;
    private ScrollView resultScroll;
    private android.widget.LinearLayout gridWrap;
    private android.view.View resultCard, progress;
    private android.widget.ProgressBar batchProgress;
    private TextView resultSold, resultMedian, resultMedianW, resultMeta;
    private TextView toggleWeb;
    private android.widget.Button extractBtn;
    private boolean webVisible = false;
    private SharedPreferences prefs;

    private String query = "";
    private String host = "";
    private int pagesWanted = 3;
    private int currentPage = 1;
    private boolean running = false;
    private boolean cookiesAppliedForRun = false;
    private boolean finished = false;
    private String pendingNextUrl = "";
    private int noItemsSeen = 0;
    // ---- batch mode ----
    private boolean batchMode = false;
    private boolean batchRunning = false;
    private java.util.List<String[]> batch = new ArrayList<>();
    private int batchIdx = 0;
    private String batchQuery = "";
    private double lastMedian = -1, lastMedianW = -1, lastSold = -1;
    private String lastCurrency = "";
    private int lastInWindow = 0, lastPages = 0;
    private String csv(String s) {
        return s.contains(",") || s.contains("\"") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }
    private final StringBuilder resultsCsv = new StringBuilder(
            "query_id,query,franchise,character,goods,sold_90d,median,median_weighted,currency,listings,listings_in_window,pages,status\n");
    private final java.util.HashSet<String> seenBatches = new java.util.HashSet<>();
    private String lastEvalUrl = "";
    private final List<double[]> items = new ArrayList<>();   // {price, qty, dateMs(-1 unknown)}
    private final List<String[]> recent = new ArrayList<>(); // {price, cur, dateMs, imgUrl, title}
    private final List<String> currencies = new ArrayList<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        prefs = getSharedPreferences("settings", MODE_PRIVATE);

        siteSpinner = findViewById(R.id.spinner_site);
        ArrayAdapter<String> ad = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_item);
        for (String[] s : SITES) ad.add(s[0]);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        siteSpinner.setAdapter(ad);
        siteSpinner.setSelection(2);   // eBay FR default

        queryInput = findViewById(R.id.input_query);
        status = findViewById(R.id.status);
        result = findViewById(R.id.result);
        resultScroll = findViewById(R.id.result_scroll);
        resultCard = findViewById(R.id.result_card);
        gridWrap = findViewById(R.id.result_grid);
        progress = findViewById(R.id.progress);
        batchProgress = findViewById(R.id.batch_progress);
        resultSold = findViewById(R.id.result_sold);
        resultMedian = findViewById(R.id.result_median);
        resultMedianW = findViewById(R.id.result_median_w);
        resultMeta = findViewById(R.id.result_meta);
        toggleWeb = findViewById(R.id.btn_toggle_web);
        extractBtn = findViewById(R.id.btn_extract);
        Button settings = findViewById(R.id.btn_settings);

        toggleWeb.setOnClickListener(v -> {
            if (!webVisible) {
                setWebVisible(true);
                String cur = wv.getUrl();
                if (cur == null || cur.contains("about:blank")) {
                    wv.loadUrl("https://" + host + "/");
                }
            } else {
                setWebVisible(false);
            }
        });

        settings.setOnClickListener(v ->
                startActivity(new Intent(this, SettingsActivity.class)));

        Button batchBtn = findViewById(R.id.btn_batch);
        batchBtn.setOnClickListener(v -> {
            if (running || (batchMode && batchRunning)) {
                batchRunning = false;
                running = false;
                finished = true;
                status.setText("Stopped. Progress saved - press Batch again to resume.");
                extractBtn.setText("Extract sold stats");
                extractCmd(true);
                progress.setVisibility(android.view.View.GONE);
                if (batchProgress != null) batchProgress.setVisibility(android.view.View.GONE);
                if (batchMode) stopService(new Intent(this, BatchService.class));
                return;
            }
            if (batch.isEmpty()) loadBatch();
            if (batch.isEmpty()) {
                status.setText("[Batch] no catalog available - add one in Settings.");
                return;
            }
            String curCustom = prefs.getString("custom_catalog", "").trim();
            if (!curCustom.equals(prefs.getString("batch_custom_used", ""))) {
                prefs.edit().putInt("batch_idx", 0)
                        .putString("batch_custom_used", curCustom).apply();
                status.setText("[Batch] catalog changed - starting from the beginning.");
                beginBatch(0);
                return;
            }
            int saved = prefs.getInt("batch_idx", 0);
            if (saved > 0 && saved < batch.size()) {
                status.setText("[Batch] resuming at " + (saved + 1) + "/" + batch.size()
                        + " - finished queries are skipped.");
                beginBatch(saved);
            } else if (saved >= batch.size() && saved > 0) {
                new android.app.AlertDialog.Builder(this)
                        .setTitle("Batch already complete")
                        .setMessage("All " + batch.size() + " queries were already checked. "
                                + "Start over from the beginning?")
                        .setPositiveButton("Start over", (d, w) -> {
                            prefs.edit().putInt("batch_idx", 0).apply();
                            beginBatch(0);
                        })
                        .setNegativeButton("Keep results", null).show();
            } else {
                status.setText("[Batch] starting: " + batch.size() + " queries (polite pacing)");
                beginBatch(0);
            }
        });

        findViewById(R.id.btn_share).setOnClickListener(v -> {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, "eBay sold checker results");
            i.putExtra(Intent.EXTRA_TEXT, resultsCsv.toString().length() > 900000
                    ? resultsCsv.substring(resultsCsv.length() - 900000)
                    : resultsCsv.toString());
            startActivity(Intent.createChooser(i, "Export results CSV"));
        });

        findViewById(R.id.btn_view_results).setOnClickListener(v -> showResultsSoFar());

        wv = findViewById(R.id.webview);
        WebSettings ws = wv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(null);
        ws.setLoadsImagesAutomatically(true);
        ws.setBlockNetworkImage(true);
        ws.setMediaPlaybackRequiresUserGesture(true);
        ws.setSupportZoom(false);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        wv.addJavascriptInterface(new Bridge(), "Android");
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!running) return;
                if (url.equals(lastEvalUrl)) return;   // one driver run per page
                lastEvalUrl = url;
                view.postDelayed(() -> view.evaluateJavascript(DRIVER_JS, null), 500);
            }
        });

        extractBtn.setOnClickListener(v -> {
            if (batchMode && batchRunning) {
                batchRunning = false;
                running = false;
                finished = true;
                progress.setVisibility(android.view.View.GONE);
                if (batchProgress != null) batchProgress.setVisibility(android.view.View.GONE);
                extractBtn.setText("Extract sold stats");
                extractCmd(true);
                status.setText("Stopped. Progress saved - press Batch again to resume.");
                stopService(new Intent(this, BatchService.class));
                return;
            }
            if (running) {
                running = false;
                finished = true;
                progress.setVisibility(android.view.View.GONE);
                extractBtn.setText("Extract sold stats");
                extractCmd(true);
                status.setText("Stopped.");
                return;
            }
            String q = queryInput.getText().toString().trim();
            if (q.isEmpty()) {
                Toast.makeText(this, "Type a search title first", Toast.LENGTH_SHORT).show();
                return;
            }
            startRun(q);
        });
    }

    private void beginBatch(int idx) {
        batchIdx = idx;
        batchMode = true;
        batchRunning = true;
        startService(new Intent(this, BatchService.class));
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(
                "android.permission.POST_NOTIFICATIONS")
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 7);
        }
        prefs.edit().putString("results_csv", resultsCsv.toString()).apply();
        loadBatchPrefResults();
        runBatchCurrent(400);
    }

    private void startRun(String q) {
        wv.resumeTimers();
        wv.clearHistory();
        query = q;
        host = SITES[siteSpinner.getSelectedItemPosition()][1];
        pagesWanted = prefs.getInt("pages", 3);
        items.clear();
        recent.clear();
        currencies.clear();
        seenBatches.clear();
        gridWrap.removeAllViews();
        currentPage = 1;
        noItemsSeen = 0;
        lastEvalUrl = "";
        finished = false;
        cookiesAppliedForRun = false;
        running = true;
        result.setText("");
        resultCard.setVisibility(android.view.View.GONE);
        progress.setVisibility(android.view.View.VISIBLE);
        if (!batchMode) { extractBtn.setText("Stop"); }
        extractCmd(false);
        pageCounter = 1;
        status.setText((batchMode ? "[Batch " + (batchIdx + 1) + "/" + batch.size() + "] " : "")
                + "Loading eBay sold search on " + host + " ...");
        wv.loadUrl(pageUrl(1));
    }

    private int pageCounter = 1;

    private void extractCmd(boolean idle) {
        int color = idle ? 0xff0a4fa0 : 0xffd64545;
        extractBtn.setBackgroundTintList(android.content.res.ColorStateList.valueOf(color));
    }

    private void setWebVisible(boolean visible) {
        webVisible = visible;
        int dp = Math.max(1, (int) (getResources().getDisplayMetrics().density));
        ViewGroup.LayoutParams lp = wv.getLayoutParams();
        lp.height = visible ? Math.min(420, 480) * dp : 0;
        wv.setLayoutParams(lp);
        wv.setVisibility(visible ? android.view.View.VISIBLE : android.view.View.GONE);
        wv.getSettings().setBlockNetworkImage(!visible);
        toggleWeb.setText(visible ? "Hide browser" : "Show browser");
    }

    private void showResultsSoFar() {
        loadBatchPrefResults();
        String[] lines = resultsCsv.toString().split("\n");
        List<String[]> data = new ArrayList<>();
        for (int i = 1; i < lines.length; i++) {
            String ln = lines[i];
            if (ln.isEmpty()) continue;
            String[] p = ln.split(",", -1);
            int n = p.length;
            if (n < 9) continue;
            String sold = p[n - 8], median = p[n - 7], cur = p[n - 5];
            String goods = p[n - 9], character = p[n - 10], franchise = p[n - 11];
            String name = esc(tc(character));
            String gd = esc(tc(goods));
            String fr = esc(tc(franchise));
            String nm = goods.length() + character.length() == 0 ? esc(p[1]) : name;
            if (character.equals("custom") || character.isEmpty()) {
                nm = esc(p[1]); gd = ""; fr = "";
            }
            String thumb = thumbFor(p[1]);
            data.add(new String[]{nm, gd, fr, sold, median, cur, thumb});
        }
        if (data.isEmpty()) {
            Toast.makeText(this, "No results yet - run some queries first.",
                    Toast.LENGTH_SHORT).show();
            return;
        }
        String html = buildInfographic(data);
        WebView pv = new WebView(this);
        pv.getSettings().setLoadWithOverviewMode(true);
        pv.getSettings().setUseWideViewPort(true);
        pv.getSettings().setLoadsImagesAutomatically(true);
        pv.setVerticalScrollBarEnabled(true);
        android.app.AlertDialog dlg = new android.app.AlertDialog.Builder(this)
                .setTitle("Results infographic")
                .setView(pv)
                .setPositiveButton("Close", null)
                .create();
        pv.loadDataWithBaseURL("https://www.ebay.fr/", html, "text/html", "utf-8", null);
        dlg.show();
        dlg.getWindow().setLayout(-1, -1);
        dlg.setOnDismissListener(d -> pv.destroy());
    }

    private String tc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 4);
        for (String w : s.split(" ")) {
            if (w.isEmpty()) continue;
            b.append(Character.toUpperCase(w.charAt(0)));
            if (w.length() > 1) b.append(w.substring(1));
            b.append(' ');
        }
        return b.toString().trim();
    }

    private String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private String thumbFor(String q) {
        try {
            String u = thumbs().optString(q, "");
            if (u.indexOf("/s-l") > -1) u = u.replaceAll("/s-l\\d+", "/s-l64");
            return u;
        } catch (Exception e) { return ""; }
    }

    private org.json.JSONObject thumbs() throws Exception {
        String raw = prefs.getString("thumbs", "");
        return new org.json.JSONObject(raw.isEmpty() ? "{}" : raw);
    }

    private void saveThumb(String q, String img) {
        try {
            if (q == null || q.isEmpty() || img == null || img.isEmpty()) return;
            org.json.JSONObject t = thumbs();
            if (!t.has(q)) {
                t.put(q, img);
                prefs.edit().putString("thumbs", t.toString()).apply();
            }
        } catch (Exception ignored) { }
    }

    private String pct(double part, double max) {
        return String.format(Locale.US, "%.0f", max <= 0 ? 100 : Math.min(100, part / max * 100));
    }

    private String buildInfographic(List<String[]> data) {
        int checked = data.size();
        List<String[]> found = new ArrayList<>();
        long totalSold = 0;
        List<Double> medians = new ArrayList<>();
        String cur = "EUR";
        for (String[] r : data) {
            long s;
            try { s = Long.parseLong(r[3]); } catch (Exception e) { s = 0; }
            if (s <= 0) continue;
            found.add(r);
            totalSold += s;
            if (!r[4].isEmpty()) {
                try { medians.add(Double.parseDouble(r[4])); } catch (Exception ignored) { }
                if (!r[5].isEmpty()) cur = r[5];
            }
        }
        String sym = "EUR".equals(cur) || cur.isEmpty() ? "&nbsp;&euro;"
                : ("GBP".equals(cur) ? "&nbsp;&pound;" : ("USD".equals(cur) ? "&nbsp;$" : "&nbsp;" + esc(cur)));
        List<Double> mm = new ArrayList<>(medians);
        Collections.sort(mm);
        double typical = mm.isEmpty() ? 0 : medianSimple(mm);
        Collections.sort(found, (a, b) -> {
            long sa = 0, sb = 0;
            try { sa = Long.parseLong(a[3]); } catch (Exception ignored) { }
            try { sb = Long.parseLong(b[3]); } catch (Exception ignored) { }
            return Long.compare(sb, sa);
        });
        int showTop = Math.min(12, found.size());
        double mx = 1;
        try { mx = Math.max(1, Long.parseLong(found.get(0)[3])); } catch (Exception ignored) { }
        java.util.Map<String, Long> fr = new java.util.LinkedHashMap<>();
        java.util.Map<String, Long> gd = new java.util.LinkedHashMap<>();
        for (String[] r : found) {
            long s;
            try { s = Long.parseLong(r[3]); } catch (Exception e) { s = 0; }
            if (!r[2].isEmpty()) fr.merge(r[2], s, Long::sum);
            if (!r[1].isEmpty()) gd.merge(r[1], s, Long::sum);
        }
        List<java.util.Map.Entry<String, Long>> frt = new ArrayList<>(fr.entrySet());
        List<java.util.Map.Entry<String, Long>> gdt = new ArrayList<>(gd.entrySet());
        frt.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        gdt.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        while (frt.size() > 5) frt.remove(frt.size() - 1);
        while (gdt.size() > 6) gdt.remove(gdt.size() - 1);
        double frmx = frt.isEmpty() ? 1 : Math.max(1, frt.get(0).getValue());
        double gdmx = gdt.isEmpty() ? 1 : Math.max(1, gdt.get(0).getValue());

        StringBuilder H = new StringBuilder();
        H.append("<!doctype html><html><head><meta charset=\"utf-8\">")
          .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
          .append("<style>*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}")
          .append("body{font-family:Roboto,'Segoe UI',Arial,sans-serif;background:#eef1f5;color:#21242b;padding:10px}")
          .append(".card{background:#fff;border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(16,24,40,.08)}")
          .append("h1{font-size:20px;color:#0a4fa0;margin-bottom:3px}")
          .append(".sub{font-size:13px;color:#3f4652;margin-bottom:14px}")
          .append(".kpis{display:flex;gap:8px}")
          .append(".kpi{flex:1;background:#f4f7fb;border-radius:12px;padding:10px 4px;text-align:center;min-width:0}")
          .append(".kpi .v{font-size:21px;font-weight:800;color:#0a4fa0;white-space:nowrap}")
          .append(".kpi .l{font-size:9px;color:#8a919e;letter-spacing:.4px;text-transform:uppercase;margin-top:3px;line-height:1.25}")
          .append("h2.sec{font-size:14px;font-weight:800;color:#21242b;margin-bottom:10px;display:flex;align-items:center;gap:7px}")
          .append("h2.sec:before{content:'';display:inline-block;width:4px;height:14px;border-radius:2px;background:#0a4fa0;flex:none}")
          .append(".mover{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f0f2f6}")
          .append(".mover:last-child{border-bottom:none}")
          .append(".rank{width:20px;height:20px;border-radius:50%;background:#eef3fa;color:#0a4fa0;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none;align-self:center}")
          .append(".mover.first .rank{background:#f5a623;color:#fff}")
          .append(".mover img,.ph{width:52px;height:52px;border-radius:10px;flex:none;object-fit:cover;border:1px solid #e6eaf0;background:#e6eaf0}")
          .append(".ph{display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#b6c5da}")
          .append(".mi{flex:1;min-width:0}")
          .append(".mname{font-size:13.5px;font-weight:700;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}")
          .append(".mgoods{font-size:12px;color:#5f6672;margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}")
          .append(".bar{height:10px;background:#e6eaf0;border-radius:5px;margin-top:7px;overflow:hidden}")
          .append(".bar span{display:block;height:10px;border-radius:5px;background:linear-gradient(90deg,#0a4fa0,#3679d8)}")
          .append(".mover.first .bar span{background:linear-gradient(90deg,#e8890a,#f5a623)}")
          .append(".mright{text-align:right;flex:none;margin-left:8px;min-width:56px;align-self:center}")
          .append(".mcount{font-size:18px;font-weight:800;color:#0a4fa0;line-height:1.1;font-variant-numeric:tabular-nums}")
          .append(".mover.first .mcount{color:#e8890a}")
          .append(".mcount small{font-size:10.5px;color:#8a919e;font-weight:700;letter-spacing:.3px}")
          .append(".hbar{display:flex;align-items:center;gap:10px;font-size:13px;padding:7px 0}")
          .append(".hbar .n{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#21242b;font-weight:700}")
          .append(".hbar .t{flex:1.5;height:14px;background:#e6eaf0;border-radius:7px;overflow:hidden}")
          .append(".hbar .t span{display:block;height:14px;border-radius:7px;background:linear-gradient(90deg,#0a4fa0,#3679d8)}")
          .append(".hbar .v{text-align:right;font-weight:800;flex:none;min-width:52px;color:#0a4fa0;font-variant-numeric:tabular-nums}")
          .append(".foot{font-size:11px;color:#8a919e;text-align:center;padding:4px 0 10px}")
          .append("</style></head><body>");
        H.append("<div class=\"card\"><h1>Batch results</h1>")
          .append("<div class=\"sub\">").append(checked).append(" queries checked &middot; ")
          .append(found.size()).append(" with sales in the last 90 days</div><div class=\"kpis\">")
          .append("<div class=\"kpi\"><div class=\"v\">").append(found.size())
          .append("</div><div class=\"l\">Found<br>sales</div></div>")
          .append("<div class=\"kpi\"><div class=\"v\">").append(checked == 0 ? 0 : found.size() * 100 / checked)
          .append("%</div><div class=\"l\">Queries<br>with sales</div></div>")
          .append("<div class=\"kpi\"><div class=\"v\">").append(String.format(Locale.US, "%,d", totalSold))
          .append("</div><div class=\"l\">Items<br>sold</div></div>")
          .append("<div class=\"kpi\"><div class=\"v\">")
          .append(String.format(Locale.US, "%.2f", typical)).append(sym)
          .append("</div><div class=\"l\">Typical<br>price</div></div></div></div>");
        H.append("<div class=\"card\"><h2 class=\"sec\">Top sellers</h2>");
        for (int i = 0; i < showTop; i++) {
            String[] r = found.get(i);
            long s;
            try { s = Long.parseLong(r[3]); } catch (Exception e) { s = 0; }
            String med = r[4].isEmpty() ? ""
                    : " &middot; median " + r[4] + sym;
            String meta = (r[1].isEmpty() ? "" : r[1] + med) + (r[1].isEmpty() ? med : "");
            String initial = r[0].isEmpty() ? "?" : r[0].substring(0, 1);
            H.append("<div class=\"mover").append(i == 0 ? " first" : "")
              .append("\"><div class=\"rank\">").append(i + 1).append("</div>");
            if (r[6].isEmpty()) {
                H.append("<div class=\"ph\">").append(esc(initial)).append("</div>");
            } else {
                H.append("<img src=\"").append(r[6]).append("\">");
            }
            H.append("<div class=\"mi\"><div class=\"mname\">").append(r[0]).append("</div>")
              .append("<div class=\"mgoods\">").append(meta).append("</div>")
              .append("<div class=\"bar\"><span style=\"width:").append(pct(s, mx))
              .append("%\"></span></div></div><div class=\"mright\"><div class=\"mcount\">")
              .append(s).append("<br><small>sold</small></div></div></div>");
        }
        H.append("</div>");
        H.append("<div class=\"card\"><h2 class=\"sec\">Sold by franchise</h2>");
        for (java.util.Map.Entry<String, Long> e : frt) {
            H.append("<div class=\"hbar\"><div class=\"n\">").append(e.getKey())
              .append("</div><div class=\"t\"><span style=\"width:").append(pct(e.getValue(), frmx))
              .append("%\"></span></div><div class=\"v\">").append(e.getValue()).append("</div></div>");
        }
        H.append("</div><div class=\"card\"><h2 class=\"sec\">Sold by goods type</h2>");
        for (java.util.Map.Entry<String, Long> e : gdt) {
            H.append("<div class=\"hbar\"><div class=\"n\">").append(e.getKey())
              .append("</div><div class=\"t\"><span style=\"width:").append(pct(e.getValue(), gdmx))
              .append("%\"></span></div><div class=\"v\">").append(e.getValue()).append("</div></div>");
        }
        H.append("</div><div class=\"foot\">Items sold &middot; median price per query &middot; last 90 days<br>")
          .append("Full data: Share CSV &middot; eBay Sold Stats</div></body></html>");
        return H.toString();
    }

    private void loadBatch() {
        try {
            String custom = prefs.getString("custom_catalog", "").trim();
            if (!custom.isEmpty()) {
                for (String line : custom.split("\\n")) {
                    String q = line.trim();
                    if (q.isEmpty()) continue;
                    // optional CSV form: franchise,character,goods,query
                    String[] parts = line.split(",", -1);
                    if (parts.length >= 4) {
                        batch.add(new String[]{"", parts[0].trim(), parts[1].trim(),
                                parts[2].trim(), parts[3].trim(), "fr"});
                    } else {
                        batch.add(new String[]{"", "custom", "", "", q, "fr"});
                    }
                }
                status.setText("[Batch] custom catalog: " + batch.size() + " queries");
            }
        } catch (Exception ignored) { }
        if (!batch.isEmpty()) return;
        try {
            java.io.BufferedReader br = new java.io.BufferedReader(
                    new java.io.InputStreamReader(getAssets().open("queries.csv")));
            String line = br.readLine();   // header
            while ((line = br.readLine()) != null) {
                String[] parts = line.split(",", -1);
                if (parts.length >= 5) batch.add(parts);
            }
            br.close();
        } catch (Exception e) {
            status.setText("Could not read catalog: " + e);
        }
    }

    private void loadBatchPrefResults() {
        String saved = prefs.getString("results_csv", "");
        if (!saved.contains("\n")) return;
        String[] lines = saved.split("\n");
        if (lines.length > 1 && lines[0].startsWith("query_id")) {
            resultsCsv.setLength(0);
            resultsCsv.append(lines[0]).append('\n');
            for (int i = 1; i < lines.length; i++) {
                if (!lines[i].isEmpty()) resultsCsv.append(lines[i]).append('\n');
            }
        }
    }

    /** Runs the query at batchIdx after ms delay; called per query. */
    private void batchStatus(String msg) {
        int total = Math.max(1, batch.size());
        int p = batchIdx * 100 / total;
        batchProgress.setProgress(p);
        status.setText("[Batch " + batchIdx + "/" + batch.size() + " \u00b7 " + p + "%] " + msg);
    }

    private void runBatchCurrent(long ms) {
        if (!batchMode) return;
        if (batchIdx >= batch.size()) { finishBatch(); return; }
        final String[] row = batch.get(batchIdx);
        final int idx = batchIdx;
        batchProgress.setVisibility(android.view.View.VISIBLE);
        batchStatus("next: " + row[4] + " in " + (ms / 1000) + "s \u2013 red button stops");
        extractBtn.setText("Stop batch");
        extractCmd(false);
        wv.postDelayed(() -> {
            if (!batchMode || !batchRunning || batchIdx != idx) return;
            batchQuery = row[4];
            siteSpinner.setSelection(2);   // FR
            host = row.length > 5 && row[5].equals("us") ? SITES[0][1] : SITES[2][1];
            startRun(batchQuery);
        }, ms);
    }

    private void finishBatch() {
        batchMode = false;
        batchRunning = false;
        stopService(new Intent(this, BatchService.class));
        batchProgress.setVisibility(android.view.View.GONE);
        extractBtn.setText("Extract sold stats");
        extractCmd(true);
        resultCard.setVisibility(android.view.View.VISIBLE);
        status.setText("[Batch] complete - "
                + (resultsCsv.toString().split("\n").length - 1) + " rows saved. "
                + "Use 'See results' to review or 'Share CSV' to export them.");
    }

    private String pageUrl(int page) {
        try {
            return "https://" + host + "/sch/i.html?_nkw="
                    + URLEncoder.encode(query, "UTF-8")
                    + "&LH_Sold=1&LH_Complete=1&_ipg=120&_pgn=" + page;
        } catch (Exception e) {
            return "https://" + host + "/";
        }
    }

    private class Bridge {

        @JavascriptInterface
        public boolean hasCreds() {
            return !prefs.getString("email", "").isEmpty()
                    && !prefs.getString("password", "").isEmpty();
        }

        @JavascriptInterface
        public String email() { return prefs.getString("email", ""); }

        @JavascriptInterface
        public String password() { return prefs.getString("password", ""); }

        @JavascriptInterface
        public void wall403() {
            runOnUiThread(() -> doWall403());
        }

        private void doWall403() {
            {
            if (!cookiesAppliedForRun && applyCookiesForHost()) {
                cookiesAppliedForRun = true;
                status.setText("403 wall detected - applying your Settings cookies and retrying ...");
                lastEvalUrl = "";
                wv.postDelayed(() -> wv.loadUrl(pageUrl(currentPage)), 1500);
            } else {
                status.setText("eBay is blocking this marketplace (403).\n"
                        + "Open Settings and paste an EditThisCookie JSON export "
                        + "for this marketplace, then try again.");
                running = false;
            }
            }
        }

        @JavascriptInterface
        public void needLogin() {
            runOnUiThread(() -> {
                setWebVisible(true);
                status.setText("eBay wants a sign-in for sold search - signing in "
                        + (hasCreds() ? "with your saved account ..." : "")
                        + "\nIf a check appears, complete it once in the view below.");
            });
        }

        @JavascriptInterface
        public void noItems(final String title) {
            runOnUiThread(() -> handleNoItems(title));
        }

        private void handleNoItems(String title) {
            {
            if (title != null && (title.contains("Se connecter")
                    || title.toLowerCase(Locale.ROOT).contains("sign in"))) {
                wv.post(() -> setWebVisible(true));
                status.setText("Sign-in page shown - complete it in the view below "
                        + "(once), the extraction resumes automatically.");
                return;
            }
            if (finished) return;
            noItemsSeen++;
            if (noItemsSeen <= 2) {
                // interstitial / still-hydrating page: re-check before concluding
                status.setText("Waiting for results page to settle ...");
                wv.postDelayed(() -> {
                    if (running) wv.evaluateJavascript(DRIVER_JS, null);
                }, 1600);
                return;
            }
            endRun(!items.isEmpty());
            }
        }

        @JavascriptInterface
        public void postItems(final String json, final String nextUrl) {
            runOnUiThread(() -> ingestItems(json, nextUrl));
        }

        private void ingestItems(String json, String nextUrl) {
            {
            pendingNextUrl = nextUrl == null ? "" : nextUrl;
            try {
                JSONArray arr = new JSONArray(json);
                // batch signature: guards against the same results page being
                // evaluated twice (redirects, reloads) WITHOUT merging distinct
                // listings that happen to share price/qty/date/title.
                if (arr.length() == 0) { endRun(!items.isEmpty()); return; }
                double sum = 0;
                StringBuilder sig = new StringBuilder().append(arr.length());
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    sum += o.getDouble("p");
                    if (i < 3) sig.append('|').append(o.optDouble("p", 0))
                            .append(',').append(o.optDouble("d", -1))
                            .append(',').append(o.optString("t", ""));
                }
                String signature = sig + "#" + String.format(Locale.US, "%.2f", sum);
                if (!seenBatches.add(signature)) {
                    // identical batch already ingested (page re-render); ignore
                    if (currentPage >= pagesWanted || currentPage >= 4) endRun(true);
                    return;
                }
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    items.add(new double[]{o.getDouble("p"), o.getDouble("q"),
                            o.optDouble("d", -1)});
                    recent.add(new String[]{String.valueOf(o.getDouble("p")),
                            o.optString("c", ""), String.valueOf(o.optDouble("d", -1)),
                            o.optString("v", ""), o.optString("t", ""),
                            o.optString("u", "")});
                    if (!o.optString("c", "").isEmpty()) currencies.add(o.getString("c"));
                }
            } catch (Exception ignored) { }

            noItemsSeen = 0;
            if (finished) return;
            wv.post(() -> { if (webVisible) setWebVisible(false); });
            if (currentPage < pagesWanted && currentPage < 4) {
                status.setText("Page " + currentPage + " parsed ("
                        + items.size() + " listings) - loading next ...");
                int next = currentPage + 1;
                final String nu = pendingNextUrl;
                pendingNextUrl = "";
                currentPage = next;
                wv.postDelayed(() -> {
                    String u = (nu != null && !nu.isEmpty()) ? nu : pageUrl(next);
                    wv.loadUrl(u);
                }, 2000);
            } else {
                endRun(true);
            }
            }
        }
    }

    private boolean applyCookiesForHost() {
        String raw = prefs.getString("cookies_json", "").trim();
        if (raw.isEmpty()) return false;
        try {
            JSONArray arr = new JSONArray(raw);
            CookieManager cm = CookieManager.getInstance();
            int applied = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject c = arr.getJSONObject(i);
                String domain = c.optString("domain", "").toLowerCase(Locale.ROOT);
                if (domain.isEmpty()) continue;
                String bare = domain.startsWith(".") ? domain.substring(1) : domain;
                if (!host.endsWith(bare)) continue;
                StringBuilder cookie = new StringBuilder();
                cookie.append(c.getString("name")).append("=").append(c.getString("value"));
                cookie.append("; Domain=").append(domain);
                cookie.append("; Path=").append(c.optString("path", "/"));
                if (c.optBoolean("secure", false)) cookie.append("; Secure");
                cm.setCookie("https://" + bare + "/", cookie.toString());
                applied++;
            }
            cm.flush();
            return applied > 0;
        } catch (Exception e) {
            return false;
        }
    }

    private void endRun(boolean showSummary) {
        if (finished) return;
        finished = true;
        running = false;
        wv.pauseTimers();
        wv.clearHistory();
        progress.setVisibility(android.view.View.GONE);
        if (!batchMode) {
            extractBtn.setText("Extract sold stats");
            extractCmd(true);
        }

        long now = System.currentTimeMillis();
        final long days90 = 90L * 24 * 60 * 60 * 1000;
        List<double[]> inWindow = new ArrayList<>();
        for (double[] it : items) {
            if (it[2] < 0 || now - (long) it[2] <= days90) inWindow.add(it);
        }
        double soldCount = 0;
        List<Double> prices = new ArrayList<>();
        List<double[]> weighted = new ArrayList<>();
        for (double[] it : inWindow) {
            soldCount += it[1];
            prices.add(it[0]);
            weighted.add(it);
        }
        Collections.sort(prices);
        lastSold = soldCount;
        lastMedian = prices.isEmpty() ? -1 : medianSimple(prices);
        lastMedianW = weighted.isEmpty() ? -1 : medianWeighted(weighted);
        lastCurrency = currencies.isEmpty() ? "" : currencies.get(0);
        lastInWindow = inWindow.size();
        lastPages = pageCounter;
        String cur = lastCurrency;

        if (batchMode && !batch.isEmpty() && !batchQuery.isEmpty()) {
            for (int k = items.size() - 1; k >= 0; k--) {
                double[] it = items.get(k);
                boolean inWin = it[2] < 0 || now - (long) it[2] <= days90;
                if (inWin && k < recent.size() && !recent.get(k)[3].isEmpty()) {
                    saveThumb(batchQuery, recent.get(k)[3]);
                    break;
                }
            }
            resultsCsv.append(batch.get(batchIdx)[0]).append(',')
                    .append(csv(batchQuery)).append(',')
                    .append(csv(batch.get(batchIdx)[1])).append(',')
                    .append(csv(batch.get(batchIdx)[2])).append(',')
                    .append(csv(batch.get(batchIdx)[3])).append(',')
                    .append(String.valueOf((long) soldCount)).append(',')
                    .append(lastMedian < 0 ? "" : String.format(Locale.US, "%.2f", lastMedian)).append(',')
                    .append(lastMedianW < 0 ? "" : String.format(Locale.US, "%.2f", lastMedianW)).append(',')
                    .append(cur).append(',')
                    .append(items.size()).append(',')
                    .append(lastInWindow).append(',')
                    .append(lastPages).append(',')
                    .append(inWindow.isEmpty() ? "empty" : "ok").append('\n');
            prefs.edit().putString("results_csv", resultsCsv.toString())
                    .putInt("batch_idx", batchIdx + 1).apply();
            batchIdx++;
            batchStatus("done - last: " + batchQuery + " -> " + ((long) soldCount) + " sold");
            if (batchRunning) {
                runBatchCurrent((long) (12000 + Math.random() * 9000));
            } else {
                status.setText("[Batch] stopped at " + batchIdx + "/" + batch.size()
                        + " - progress saved.");
            }
            return;
        }

        if (!showSummary || inWindow.isEmpty()) {
            status.setText("No sold listings found for this title on " + host + ".");
            return;
        }
        resultSold.setText(String.format(Locale.US, "%.0f", soldCount));
        resultMedian.setText(fmtAmount(lastMedian, cur));
        resultMedianW.setText(fmtAmount(lastMedianW, cur));
        resultMeta.setText(String.format(Locale.US,
                "%d listings scanned on %s · %d inside the 90-day window · query: %s",
                items.size(), host, inWindow.size(), query));
        resultCard.setVisibility(android.view.View.VISIBLE);
        result.setVisibility(android.view.View.VISIBLE);
        resultScroll.smoothScrollTo(0, 0);
        setWebVisible(false);
        wv.postDelayed(() -> wv.loadUrl("about:blank"), 4000);
        List<Integer> wIdx = new ArrayList<>();
        for (int k = 0; k < items.size(); k++) {
            double[] it = items.get(k);
            if (it[2] < 0 || now - (long) it[2] <= days90) wIdx.add(k);
        }
        List<String[]> recentWindow = new ArrayList<>();
        for (int k : wIdx) recentWindow.add(recent.get(k));
        gridWrap.removeAllViews();
        buildRecentGrid(recentWindow);
        result.setText(String.format(Locale.US,
                "Marketplace: %s | Title: %s | Sold last 90 days: %.0f | Median: %.2f %s | Weighted: %.2f %s | Listings in window: %d of %d",
                host, query, soldCount, lastMedian, cur, lastMedianW, cur, inWindow.size(), items.size()));
        status.setText("Done.");
    }

    private void buildRecentGrid(List<String[]> recentWindow) {
        android.widget.GridLayout grid = new android.widget.GridLayout(this);
        grid.setColumnCount(4);
        int dp = Math.max(1, (int) (getResources().getDisplayMetrics().density));
        List<String[]> cells = new ArrayList<>(recentWindow);
        Collections.sort(cells, (a, b) -> {
            double da = a[2].isEmpty() ? -1 : Double.parseDouble(a[2]);
            double db = b[2].isEmpty() ? -1 : Double.parseDouble(b[2]);
            return Double.compare(db, da);
        });
        int shown = 0;
        for (String[] r : cells) {
            if (shown >= 20) break;
            double price = Double.parseDouble(r[0]);
            int cdp = 70 * dp;
            android.widget.LinearLayout cell = new android.widget.LinearLayout(this);
            cell.setOrientation(android.widget.LinearLayout.VERTICAL);
            cell.setPadding(2 * dp, 2 * dp, 2 * dp, 2 * dp);
            android.view.ViewGroup.LayoutParams ivLp = new android.view.ViewGroup.LayoutParams(cdp, cdp);
            final android.widget.ImageView iv = new android.widget.ImageView(this);
            iv.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
            iv.setBackgroundColor(0xffeef1f5);
            final String finalUrl = r[3];
            iv.setTag(finalUrl);
            cell.addView(iv, ivLp);
            android.widget.TextView tv = new android.widget.TextView(this);
            tv.setText(fmtAmount(price, r[1]));
            tv.setTextSize(11);
            tv.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            tv.setGravity(android.view.Gravity.CENTER);
            cell.addView(tv);
            android.widget.GridLayout.LayoutParams clp = new android.widget.GridLayout.LayoutParams();
            clp.columnSpec = android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1f);
            clp.rowSpec = android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1f);
            grid.addView(cell, clp);
            shown++;
            final android.widget.ImageView fiv = iv;
            final String listingUrl = r.length > 5 ? r[5] : "";
            if (!listingUrl.isEmpty()) {
                cell.setOnClickListener(v -> {
                    setWebVisible(true);
                    status.setText("Opening the listing in the app browser ...");
                    wv.loadUrl(listingUrl);
                });
            }
            if (!finalUrl.isEmpty()) {
                new Thread(() -> {
                    java.net.HttpURLConnection c = null;
                    try {
                        java.net.URL u = new java.net.URL(finalUrl);
                        c = (java.net.HttpURLConnection) u.openConnection();
                        c.setConnectTimeout(6000);
                        c.setReadTimeout(6000);
                        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android)");
                        android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeStream(c.getInputStream());
                        if (bmp != null) runOnUiThread(() -> {
                            if (finalUrl.equals(fiv.getTag())) fiv.setImageBitmap(bmp);
                        });
                    } catch (Exception ignored) {
                    } finally {
                        if (c != null) c.disconnect();
                    }
                }).start();
            }
        }
        gridWrap.addView(grid);
        gridWrap.setVisibility(android.view.View.VISIBLE);
    }

    private String fmtAmount(double v, String cur) {
        String sym;
        switch (cur) {
            case "EUR": sym = "\u20ac"; break;
            case "USD": sym = "$"; break;
            case "GBP": sym = "\u00a3"; break;
            case "CAD": return String.format(Locale.US, "CA$%,.2f", v);
            case "AUD": return String.format(Locale.US, "AU$%,.2f", v);
            default: sym = cur + " ";
        }
        return String.format(Locale.US, sym + "%,.2f", v);
    }

    @Override
    protected void onDestroy() {
        running = false;
        batchRunning = false;
        stopService(new Intent(this, BatchService.class));
        if (wv != null) {
            wv.removeCallbacks(null);
            wv.loadUrl("about:blank");
            wv.destroy();
        }
        super.onDestroy();
    }

    private double medianSimple(List<Double> sorted) {
        int n = sorted.size();
        if (n == 0) return 0;
        if (n % 2 == 1) return sorted.get(n / 2);
        return (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2.0;
    }

    private double medianWeighted(List<double[]> pairs) {
        List<Double> expanded = new ArrayList<>();
        int total = 0;
        for (double[] p : pairs) {
            int q = (int) Math.max(1, p[1]);
            total += q;
            if (total > 20000) break;
            for (int i = 0; i < q; i++) expanded.add(p[0]);
        }
        Collections.sort(expanded);
        return medianSimple(expanded);
    }

    private static final String DRIVER_JS =
        "(function(){try{var t=document.title||'';" +
        "if(/Error Page/i.test(t)){Android.wall403();return;}" +
        "var uid=document.querySelector('input[name=\"userid\"]');" +
        "var pwEl=document.querySelector('input[name=\"pass\"]');" +
        "var form=document.querySelector('form#signin-form,form[action*=\"signin\"]');" +
        "if(form&&uid&&!pwEl){" +
        " if(Android.hasCreds()){uid.style.display='';uid.value=Android.email();" +
        " var b=document.querySelector('#signin-continue-btn')||document.querySelector('button[type=\"submit\"]');if(b){b.click();return;}}" +
        " Android.needLogin();return;}" +
        "if(form&&uid&&pwEl&&pwEl.offsetParent!==null){" +
        " if(Android.hasCreds()){uid.value=Android.email();pwEl.value=Android.password();" +
        " var s=document.querySelector('#sgnBt')||document.querySelector('button[type=\"submit\"]');if(s){s.click();return;}}" +
        " Android.needLogin();return;}" +
        "var anchors=document.querySelectorAll('a[href*=\"/itm/\"]');" +
        "if(!anchors.length){Android.noItems(t);return;}" +
        "function climb(a){var n=a;for(var i=0;i<8&&n;i++){n=n.parentElement;if(!n)return null;" +
        " var cl=(' '+(n.className||'')+' ');" +
        " if(/\\s(s-item|su-card-container|s-river|brw-results|srp-results)\\s/.test(cl))return n;" +
        " if(n.tagName==='LI'||n.tagName==='ARTICLE')return n;" +
        " if(n.tagName==='UL'||n.id==='srp-river-results')return n;}return null;}" +
        "var cards=[],seen=new Set();" +
        "for(var i=0;i<anchors.length;i++){var c=climb(anchors[i]);if(c&&!seen.has(c)){seen.add(c);cards.push(c);}}" +
        "var MONTH={jan:1,janv:1,ene:1,feb:2,febr:2,mar:3,mrz:3,mars:3,maerz:3,avr:4,apr:4,abr:4,mai:5,may:5,mag:5,maggio:5,juin:6,jun:6,giu:6,juil:7,jul:7,juli:7,lug:7,luglio:7," +
        "aug:8,aout:8,août:8,ago:8,sept:9,set:9,sen:9,oct:10,ott:10,okt:10,nov:11,dec:12,dic:12,dez:12};" +
        "function norm(n){n=(''+n).replace(/\\u00a0/g,'');" +
        " if(n.indexOf(',')>-1&&n.indexOf('.')>-1){if(n.lastIndexOf(',')>n.lastIndexOf('.')){n=n.replace(/\\./g,'').replace(',','.');}else{n=n.replace(/,/g,'');}}" +
        " else if(n.indexOf(',')>-1){var p=n.split(',');if(p.length===2&&p[0].length>0&&p[1].length<3&&/^\\d+$/.test(p[0])&&/^\\d+$/.test(p[1])){n=n.replace(',','.');}else{n=n.replace(/,/g,'');}}" +
        " else if(n.indexOf('.')>-1){var q=n.split('.');if(q.length===2&&q[1].length>2){n=n.replace(/\\./g,'');}}" +
        " var v=parseFloat(n);return isFinite(v)&&v>0?v:null;}" +
        "function parsePrice(txt){" +
        " var re=/((?:US\\s?\\$|CA\\s?\\$|AU\\s?\\$|USD|GBP|EUR|\\$|\\u00a3|\\u20ac)\\s*(\\d[\\d.,]*\\d?))|((\\d[\\d.,]*\\d?)\\s*(?:EUR\\b|GBP\\b|USD\\b|\\u20ac))/g;" +
        " var m,ships=/\\b(shipping|versand|livraison|env[i\\u00ed]o|spedizione|exp[e\\u00e9]dition|postage|porto)\\b/i;" +
        " while((m=re.exec(txt))){" +
        "  var num=m[2]!==undefined?m[2]:m[4];var before=txt.substring(Math.max(0,m.index-20),m.index);" +
        "  if(ships.test(before)&&!/\\b(sold|vendu|verkauft)\\b/i.test(before))continue;" +
        "  var cur;if(m[1]!==undefined){var s=m[1];cur=s.indexOf('$')>-1?'USD':(s.indexOf('\\u00a3')>-1?'GBP':(s.indexOf('\\u20ac')>-1?'EUR':s.substring(0,3).toUpperCase()));}else{var s2=m[0];cur=s2.indexOf('\\u00a3')>-1?'GBP':'EUR';}" +
        "  var v=norm(num);if(v!==null&&v>0)return [cur,v];}" +
        " return null;}" +
        "var QTY=/(\\d[\\d.,]*)\\+?\\s*(?:items?\\s+)?(?:sold|verkauft|vendu|vendus|vendue|vendido|vendidos|venduta|vendute|venduto|venduti)\\b/i;" +
        "function parseQty(txt){var m=QTY.exec(txt);if(!m)return 1;var before=txt.charAt(Math.max(0,m.index-1));" +
        " if(/[\\d.,$\\u00a3\\u20ac]/.test(before))return 1;var raw=m[1].replace(/[.,]/g,'');var q=parseInt(raw,10);return q>0?q:1;}" +
        "function parseDate(txt,now){" +
        " var m=/\\b(\\d{1,2})[.\\-](\\d{1,2})[.\\-](\\d{4})\\b/.exec(txt);" +
        " if(m){var d=+m[1],mo=+m[2],y=+m[3];if(mo>0&&mo<13)return new Date(y,mo-1,d).getTime();}" +
        " var r=new RegExp('\\\\b(\\\\d{1,2})[.,]?\\\\s+([a-z\\u00e0-\\u00ff]{3,7})[.,]?\\\\s+(\\\\d{4})\\\\b','i');" +
        " m=r.exec(txt);if(m){var mo2=(MONTH[m[2].toLowerCase()]||0);if(mo2){return new Date(+m[3],mo2-1,+m[1]).getTime();}}" +
        " var r2=new RegExp('\\\\b([a-z\\u00e0-\\u00ff]{3,7})[.,]?\\\\s+(\\\\d{1,2}),?\\\\s+(\\\\d{4})\\\\b','i');" +
        " m=r2.exec(txt);if(m){var mo3=(MONTH[m[1].toLowerCase().replace(/\\.$/,'')]||0);if(mo3){return new Date(+m[3],mo3-1,+m[2]).getTime();}}" +
        " var r3=/\\b(20\\d{2})-(\\d{1,2})-(\\d{1,2})\\b/.exec(txt);if(r3){return new Date(+r3[1],+r3[2]-1,+r3[3]).getTime();}" +
        " return -1;}" +
        "var out=[];" +
        "for(var j=0;j<cards.length;j++){var el=cards[j];var txt=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();" +
        " if(!/(sold|verkauft|vendu|vendido|vendut)/i.test(txt))continue;" +
        " var leaves=el.querySelectorAll('*');" +
        " var price=null,qty=1,dMs=-1;" +
        " var ships2=/\\b(shipping|versand|livraison|env[i\\u00ed]o|spedizione|exp[e\\u00e9]dition|postage|porto)\\b/i;" +
        " for(var k=0;k<leaves.length;k++){var lf=leaves[k];if(lf.children.length)continue;" +
        "  var lt=(lf.textContent||'').replace(/\\s+/g,' ').trim();if(!lt||lt.length>120)continue;" +
        "  if(!price&&!ships2.test(lt)){var pr=parsePrice(lt);if(pr)price=pr;}" +
        "  if(qty===1){var pmasked=lt.replace(/((?:US\\s?\\$|CA\\s?\\$|AU\\s?\\$|USD|GBP|EUR|\\$|\\u00a3|\\u20ac)\\s*\\d[\\d.,]*\\d?)|(\\d[\\d.,]*\\d?\\s*(?:EUR\\b|GBP\\b|USD\\b|\\u20ac))/g,' ');" +
        "   var q=parseQty(pmasked);if(q>1&&lt.length<=64)qty=q;}" +
        "  if(dMs<0){var dm=parseDate(lt,Date.now());if(dm>0)dMs=dm;}}" +
        " if(!price){var pt=parsePrice(txt);if(pt)price=pt;}" +
        " if(!price)continue;" +
        " var ttl=el.querySelector('h3, .s-item__title, [role=\"heading\"]');" +
        " var im=el.querySelector('img');var iu=(im?((im.currentSrc||im.src)+''):'');" +
        " if(iu.indexOf('ebayimg.com')<0)iu='';" +
        " if(iu.indexOf('/s-l500')>-1)iu=iu.split('/s-l500').join('/s-l200');" +
        " var la=el.querySelector('a[href*=\"/itm/\"]');var lu=la?(la.href+''):'';if(lu.indexOf('?')>-1)lu=lu.split('?')[0];" +
        " out.push({t:(ttl?ttl.textContent.trim().substring(0,80):''),p:price[1],c:price[0],q:qty,d:dMs,v:iu,u:lu});}" +
        "var cm=/_pgn=(\\d+)/.exec(location.href);var cp=cm?(+cm[1]):1;var next='';" +
        "var pl=document.querySelectorAll('a[href*=\"_pgn=\"]');" +
        "for(var k=0;k<pl.length;k++){var m2=/_pgn=(\\d+)/.exec(pl[k].href);" +
        " if(m2&&((+m2[1])===(cp+1))){next=pl[k].href;break;}}" +
        "Android.postItems(JSON.stringify(out),next);" +
        "}catch(e){Android.noItems(''+e);}})();";
}
