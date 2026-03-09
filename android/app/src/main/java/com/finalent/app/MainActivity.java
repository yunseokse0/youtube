package com.finalent.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.finalent.app.R;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);
    }
}
