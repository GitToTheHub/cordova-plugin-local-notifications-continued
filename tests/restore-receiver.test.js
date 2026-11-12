const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

// Compile the production receiver against small Android boundary doubles.
// Scheduling, persistence and threading are observed from outside the receiver.
const sources = {
    'android/content/Context.java': `package android.content;
public class Context { public Context getApplicationContext(){return this;} }`,
    'android/content/Intent.java': `package android.content;
public class Intent {
 public static final String ACTION_BOOT_COMPLETED="boot", ACTION_MY_PACKAGE_REPLACED="update";
 private final String action; public Intent(String action){this.action=action;} public String getAction(){return action;}
}`,
    'android/content/BroadcastReceiver.java': `package android.content;
import java.util.concurrent.CountDownLatch;
public abstract class BroadcastReceiver {
 public final PendingResult result=new PendingResult(); public int asyncCalls;
 public PendingResult goAsync(){asyncCalls++;return result;}
 public abstract void onReceive(Context c, Intent i);
 public static class PendingResult { public final CountDownLatch done=new CountDownLatch(1); public int finishes;
 public void finish(){finishes++;done.countDown();} }
}`,
    'android/content/SharedPreferences.java': `package android.content;
public interface SharedPreferences { Editor edit(); interface Editor {Editor remove(String key);void apply();} }`,
    'android/app/AlarmManager.java': `package android.app;
public class AlarmManager {public static final String ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED="alarm";}`,
    'android/util/Log.java': `package android.util;
public class Log {public static int d(String t,String s){return 0;} public static int e(String t,String s,Throwable e){return 0;}}`,
    'androidx/core/app/NotificationManagerCompat.java': `package androidx.core.app;
import android.content.Context;
public class NotificationManagerCompat {public static boolean enabled=true;
 public static NotificationManagerCompat from(Context c){return new NotificationManagerCompat();}
 public boolean areNotificationsEnabled(){return enabled;}}`,
    'org/json/JSONException.java': `package org.json; public class JSONException extends Exception {}`,
    'org/json/JSONObject.java': `package org.json;
public class JSONObject {private final boolean enabled; public JSONObject(boolean e){enabled=e;}
 public boolean getBoolean(String key){return enabled;}}`,
    'de/appplant/cordova/plugin/localnotification/LocalNotificationChannels.java': `package de.appplant.cordova.plugin.localnotification;
import android.content.Context; import org.json.JSONObject; import java.util.*;
public class LocalNotificationChannels {
 public static final Map<String,Integer> reads=new HashMap<>();
 public LocalNotificationChannels(Context c){} public JSONObject get(String id) throws org.json.JSONException {
 reads.put(id,reads.getOrDefault(id,0)+1);
 if(id.equals("unreadable"))throw new IllegalStateException("Settings unavailable");
 return id.equals("missing")?null:new JSONObject(!id.startsWith("blocked"));}}
`,
    'de/appplant/cordova/plugin/localnotification/Manager.java': `package de.appplant.cordova.plugin.localnotification;
import android.content.*; import java.util.*;
public class Manager {
 public static List<LocalNotificationRequest> requests; public static Thread loadedOn;
 public static final Prefs prefs=new Prefs(); public Manager(Context c){}
 public List<LocalNotificationRequest> getNotificationsFromSharedPreferences(){loadedOn=Thread.currentThread();return requests;}
 public static SharedPreferences getSharedPreferences(Context c){return prefs;}
 public static class Prefs implements SharedPreferences,SharedPreferences.Editor {
 public int applies; public final Set<String> removed=new HashSet<>();
 public Editor edit(){return this;} public Editor remove(String k){removed.add(k);return this;} public void apply(){applies++;}
 }
}`,
    'de/appplant/cordova/plugin/localnotification/LocalNotificationRequest.java': `package de.appplant.cordova.plugin.localnotification;
import java.util.*;
public class LocalNotificationRequest {
 public int scheduled; public Thread scheduledOn; public boolean fail; final int id; final Handler handler; final Options options;
 public int appliesBeforeSchedule;
 public LocalNotificationRequest(int id,Long due,boolean last,String channel){this.id=id;handler=new Handler(due,last);options=new Options(channel);}
 public void schedule(){scheduled++;scheduledOn=Thread.currentThread();appliesBeforeSchedule=Manager.prefs.applies;
 if(fail)throw new IllegalStateException("Test failure");}
 public int getId(){return id;} public Handler getTriggerHandler(){return handler;} public Options getOptions(){return options;}
 public String getSharedPreferencesKeyOptions(){return id+"options";}
 public String getSharedPreferencesKeyOccurrence(){return id+"occurrence";}
 public String getSharedPreferencesKeyTriggerBaseDate(){return id+"base";}
 public String getSharedPreferencesKeyTriggerDate(){return id+"date";}
 public static class Handler {final Date due;final boolean last;Handler(Long d,boolean l){due=d==null?null:new Date(d);last=l;}
 public Date getTriggerDate(){return due;}public boolean isLastOccurrence(){return last;}}
 public static class Options {final String channel;Options(String c){channel=c;}
 public String getAndroidChannelId(){return channel;}public String getAndroidChannelGroupId(){return null;}}
}`,
    'RestoreReceiverTest.java': `import android.content.*;
import java.util.*;import java.util.concurrent.TimeUnit;
import de.appplant.cordova.plugin.localnotification.*;
import de.appplant.cordova.plugin.localnotification.receiver.RestoreReceiver;
import androidx.core.app.NotificationManagerCompat;
public class RestoreReceiverTest {
 static void check(boolean ok,String msg){if(!ok)throw new AssertionError(msg);}
 static void run(List<LocalNotificationRequest> requests,String action)throws Exception{
 Manager.requests=requests;Manager.prefs.removed.clear();Manager.prefs.applies=0;LocalNotificationChannels.reads.clear();
 RestoreReceiver r=new RestoreReceiver();Thread caller=Thread.currentThread();r.onReceive(new Context(),new Intent(action));
 check(r.result.done.await(5,TimeUnit.SECONDS),"Broadcast never finished");
 check(r.result.finishes==1,"Broadcast finished more than once");check(Manager.loadedOn!=caller,"Preferences loaded on main thread");
 for(LocalNotificationRequest n:requests)if(n.scheduled>0)check(n.scheduledOn!=caller,"Scheduling on main thread");
 }
 public static void main(String[]args)throws Exception{
 try{
 long past=System.currentTimeMillis()-60000,future=System.currentTimeMillis()+3600000;
 List<LocalNotificationRequest> list=new ArrayList<>();
 for(int i=0;i<1001;i++)list.add(new LocalNotificationRequest(i,past,true,"blocked-channel"));
 LocalNotificationRequest futureBlocked=new LocalNotificationRequest(2001,future,true,"blocked-channel");
 LocalNotificationRequest recurring=new LocalNotificationRequest(2002,past,false,"blocked-channel");
 LocalNotificationRequest missed=new LocalNotificationRequest(2003,past,true,"enabled");
 LocalNotificationRequest missing=new LocalNotificationRequest(2004,past,true,"missing");
 LocalNotificationRequest grouped=new LocalNotificationRequest(2005,past,true,"blocked-group");
 LocalNotificationRequest unreadable=new LocalNotificationRequest(2006,past,true,"unreadable");
 LocalNotificationRequest noDate=new LocalNotificationRequest(2007,null,true,"blocked-channel");
 LocalNotificationRequest failure=new LocalNotificationRequest(2008,future,true,"enabled");failure.fail=true;
 LocalNotificationRequest afterFailure=new LocalNotificationRequest(2009,future,true,"enabled");
 Collections.addAll(list,futureBlocked,recurring,missed,missing,grouped,unreadable,noDate,failure,afterFailure);
 run(list,Intent.ACTION_MY_PACKAGE_REPLACED);
 check(Manager.prefs.removed.size()==1002*4,"Wrong cleanup keys");check(Manager.prefs.applies==1,"Cleanup not batched");
 for(int i=0;i<1001;i++)check(list.get(i).scheduled==0,"Expired blocked request restored");
 check(grouped.scheduled==0,"Blocked group request restored");
 for(LocalNotificationRequest n:Arrays.asList(futureBlocked,recurring,missed,missing,unreadable,noDate,afterFailure)){
 check(n.scheduled==1,"Valid or uncertain request lost: "+n.getId());check(n.appliesBeforeSchedule==1,"Cleanup happened after scheduling");}
 check(LocalNotificationChannels.reads.get("blocked-channel")==1,"Channel settings queried per notification");
 NotificationManagerCompat.enabled=false;
 LocalNotificationRequest disabledPast=new LocalNotificationRequest(3000,past,true,"enabled");
 LocalNotificationRequest disabledFuture=new LocalNotificationRequest(3001,future,true,"enabled");
 run(Arrays.asList(disabledPast,disabledFuture),Intent.ACTION_BOOT_COMPLETED);
 check(disabledPast.scheduled==0&&disabledFuture.scheduled==1,"App-disabled cleanup lost future work");
 check(LocalNotificationChannels.reads.isEmpty(),"Read channels despite app-level blocking");
 NotificationManagerCompat.enabled=true;
 run(Arrays.asList(new LocalNotificationRequest(4000,future,true,"enabled")),"alarm");
 check(Manager.prefs.applies==0,"Unnecessary preferences write");
 RestoreReceiver ignored=new RestoreReceiver();ignored.onReceive(new Context(),null);ignored.onReceive(new Context(),new Intent("unrelated"));
 check(ignored.asyncCalls==0,"Unexpected broadcast processed");
 System.out.println("RESTORE_RECEIVER_ALL_PASS");System.exit(0);
 }catch(Throwable e){e.printStackTrace();System.exit(1);}
 }
}`
};

test('restore receiver cleans blocked expired requests in bulk off the main thread without losing valid work', {
    skip: spawnSync('javac', ['-version']).status !== 0 ? 'A JDK is required for the Android boundary test' : false
}, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-restore-'));
    try {
        const files = Object.entries(sources).map(([name, text]) => {
            const target = path.join(root, name);
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); return target;
        });
        files.push(path.resolve(__dirname, '../src/android/receiver/RestoreReceiver.java'));
        const compiled = spawnSync('javac', ['-d', root, ...files], { encoding: 'utf8', timeout: 20000 });
        assert.equal(compiled.status, 0, compiled.stderr);
        const result = spawnSync('java', ['-cp', root, 'RestoreReceiverTest'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /RESTORE_RECEIVER_ALL_PASS/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
