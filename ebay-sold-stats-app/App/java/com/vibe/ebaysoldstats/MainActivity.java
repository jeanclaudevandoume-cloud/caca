package com.vibe.ebaysoldstats;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
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
    private android.view.View resultCard, progress;
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
    private int noItemsSeen = 0;
    private String lastEvalUrl = "";
    private final List<double[]> items = new ArrayList<>();   // {price, qty, dateMs(-1 unknown)}
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

        queryInput = findViewById(R.id.input_query);
        status = findViewById(R.id.status);
        result = findViewById(R.id.result);
        resultScroll = findViewById(R.id.result_scroll);
        resultCard = findViewById(R.id.result_card);
        progress = findViewById(R.id.progress);
        resultSold = findViewById(R.id.result_sold);
        resultMedian = findViewById(R.id.result_median);
        resultMedianW = findViewById(R.id.result_median_w);
        resultMeta = findViewById(R.id.result_meta);
        toggleWeb = findViewById(R.id.btn_toggle_web);
        extractBtn = findViewById(R.id.btn_extract);
        Button settings = findViewById(R.id.btn_settings);

        toggleWeb.setOnClickListener(v -> setWebVisible(!webVisible));

        settings.setOnClickListener(v ->
                startActivity(new Intent(this, SettingsActivity.class)));

        wv = findViewById(R.id.webview);
        WebSettings ws = wv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(null);
        ws.setLoadsImagesAutomatically(true);
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

    private void startRun(String q) {
        query = q;
        host = SITES[siteSpinner.getSelectedItemPosition()][1];
        pagesWanted = prefs.getInt("pages", 3);
        items.clear();
        currencies.clear();
        currentPage = 1;
        noItemsSeen = 0;
        lastEvalUrl = "";
        finished = false;
        cookiesAppliedForRun = false;
        running = true;
        result.setText("");
        resultCard.setVisibility(android.view.View.GONE);
        progress.setVisibility(android.view.View.VISIBLE);
        extractBtn.setText("Stop");
        extractCmd(false);
        status.setText("Loading eBay sold search on " + host + " ...");
        wv.loadUrl(pageUrl(1));
    }

    private void extractCmd(boolean idle) {
        int color = idle ? 0xffe05353 : 0xff0a4fa0;
        extractBtn.setBackgroundTintList(android.content.res.ColorStateList.valueOf(color));
    }

    private void setWebVisible(boolean visible) {
        webVisible = visible;
        int dp = Math.max(1, (int) (getResources().getDisplayMetrics().density));
        ViewGroup.LayoutParams lp0 = wv.getLayoutParams();
        if (lp0 instanceof android.widget.LinearLayout.LayoutParams) {
            android.widget.LinearLayout.LayoutParams lp =
                    (android.widget.LinearLayout.LayoutParams) lp0;
            lp.height = visible ? 420 * dp : 0;
            lp.weight = 0;
            wv.setLayoutParams(lp);
        }
        wv.setVisibility(visible ? android.view.View.VISIBLE : android.view.View.GONE);
        toggleWeb.setText(visible ? "Hide browser" : "Show browser");
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
        public void postItems(final String json) {
            runOnUiThread(() -> ingestItems(json));
        }

        private void ingestItems(String json) {
            {
            try {
                JSONArray arr = new JSONArray(json);
                int before = items.size();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    // de-duplicate across pages
                    boolean dup = false;
                    for (int k = before > 200 ? before - 200 : 0; k < items.size(); k++) {
                        double[] it = items.get(k);
                        if (it[0] == o.getDouble("p") && it[1] == o.getDouble("q")
                                && it[2] == o.optDouble("d", -1)) { dup = true; break; }
                    }
                    if (dup) continue;
                    items.add(new double[]{o.getDouble("p"), o.getDouble("q"),
                            o.optDouble("d", -1)});
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
                currentPage = next;
                wv.postDelayed(() -> wv.loadUrl(pageUrl(next)), 2000);
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
        wv.post(() -> { if (webVisible) setWebVisible(false); });
        progress.setVisibility(android.view.View.GONE);
        extractBtn.setText("Extract sold stats");
        extractCmd(true);
        if (!showSummary || items.isEmpty()) {
            status.setText("No sold listings found for this title on " + host + ".");
            return;
        }
        progress.setVisibility(android.view.View.GONE);
        extractBtn.setText("Extract sold stats");
        extractCmd(true);
        long now = System.currentTimeMillis();
        final long days90 = 90L * 24 * 60 * 60 * 1000;
        List<double[]> inWindow = new ArrayList<>();
        for (double[] it : items) {
            if (it[2] < 0 || now - (long) it[2] <= days90) inWindow.add(it);
        }
        if (inWindow.isEmpty()) {
            status.setText("Finished, but no sold listings in the last 90 days were parsed.");
            return;
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
        double simple = medianSimple(prices);
        double w = medianWeighted(weighted);
        String cur = currencies.isEmpty() ? "" : currencies.get(0);
        resultSold.setText(String.format(Locale.US, "%.0f", soldCount));
        resultMedian.setText(fmtAmount(simple, cur));
        resultMedianW.setText(fmtAmount(w, cur));
        resultMeta.setText(String.format(Locale.US,
                "%d listings scanned on %s \u00b7 %d inside the 90-day window \u00b7 query: %s",
                items.size(), host, inWindow.size(), query));
        resultCard.setVisibility(android.view.View.VISIBLE);
        result.setVisibility(android.view.View.VISIBLE);
        resultScroll.smoothScrollTo(0, 0);
        wv.loadUrl("about:blank");
        result.setText(String.format(Locale.US,
                "Marketplace: %s | Title: %s | Sold last 90 days: %.0f | Median: %.2f %s | Weighted: %.2f %s | Listings in window: %d of %d",
                host, query, soldCount, simple, cur, w, cur, inWindow.size(), items.size()));
        status.setText("Done.");
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
        " out.push({t:(ttl?ttl.textContent.trim().substring(0,80):''),p:price[1],c:price[0],q:qty,d:dMs});}" +
        "Android.postItems(JSON.stringify(out));" +
        "}catch(e){Android.noItems(''+e);}})();";
}
