package fr.alexia.app;
import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.ActivityCompat;

public class MainActivity extends Activity {
 private WebView web;
 @Override public void onCreate(Bundle b){super.onCreate(b);
  ActivityCompat.requestPermissions(this,new String[]{Manifest.permission.RECORD_AUDIO},7);
  web=new WebView(this); web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
  web.setWebViewClient(new WebViewClient());
  web.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest r){runOnUiThread(()->r.grant(r.getResources()));}});
  web.loadUrl("https://alexia-flame.vercel.app"); setContentView(web);
 }
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
}