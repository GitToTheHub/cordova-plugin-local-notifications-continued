#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>
#import <Cordova/CDVPlugin.h>
#import <Cordova/CDVInvokedUrlCommand.h>
#import <Cordova/CDVPluginResult.h>
@interface NSObject (ProbeAPI)
- (void)schedule:(id)c;
- (void)update:(id)c;
- (void)requestPermission:(id)c;
@end
@interface ProbeSettings:NSObject
@end
@implementation ProbeSettings
- (UNAuthorizationStatus)authorizationStatus{return UNAuthorizationStatusAuthorized;}
- (UNNotificationSetting)notificationCenterSetting{return UNNotificationSettingEnabled;}
@end
@interface ProbeCenter:NSObject
@property int count;
@property int failAt;
@property BOOL deny;
@property BOOL authError;
@property NSMutableDictionary *requests;
@end
@implementation ProbeCenter
- (instancetype)init{if((self=[super init]))_requests=[NSMutableDictionary new];return self;}
- (void)addNotificationRequest:(UNNotificationRequest*)r withCompletionHandler:(void(^)(NSError*))done{
 self.count++;NSError *e=self.count==self.failAt?[NSError errorWithDomain:@"ProbeError" code:42 userInfo:@{NSLocalizedDescriptionKey:@"injected scheduling failure"}]:nil;
 if(!e)self.requests[r.identifier]=r;
 dispatch_async(dispatch_get_main_queue(),^{done(e);});
}
- (id)getNotificationWithId:(NSNumber*)i{return self.requests[i.stringValue];}
- (void)getNotificationSettingsWithCompletionHandler:(void(^)(id))done{done([ProbeSettings new]);}
- (void)requestAuthorizationWithOptions:(NSUInteger)o completionHandler:(void(^)(BOOL,NSError*))done{
 done(!self.deny,self.authError?[NSError errorWithDomain:@"ProbeError" code:43 userInfo:@{NSLocalizedDescriptionKey:@"injected permission failure"}]:nil);
}
@end
@interface ProbeDelegate:NSObject
@property(copy)void(^result)(CDVPluginResult*);
@end
@implementation ProbeDelegate
- (void)runInBackground:(void(^)(void))b{dispatch_async(dispatch_get_global_queue(0,0),b);}
- (void)sendPluginResult:(CDVPluginResult*)r callbackId:(NSString*)i{self.result(r);}
- (void)evalJs:(NSString*)s{}
@end
static id plugin;
static ProbeCenter *center;
static ProbeDelegate *delegate;
static int stage=0;
static void invoke(NSString*method,NSArray*args){
 id command=[[NSClassFromString(@"CDVInvokedUrlCommand") alloc]initWithArguments:args callbackId:@"probe" className:@"LocalNotification" methodName:method];
 [plugin performSelector:NSSelectorFromString([method stringByAppendingString:@":"]) withObject:command];
}
static NSDictionary*options(int i){return @{ @"id":@(i),@"title":@"Probe",@"text":@"Test",@"sound":@"default",@"trigger":@{@"type":@"calendar",@"at":@([[NSDate date] timeIntervalSince1970]*1000+3600000)}};}
__attribute__((constructor))static void startProbe(void){dispatch_after(dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC),dispatch_get_main_queue(),^{
 plugin=[NSClassFromString(@"APPLocalNotification") new];center=[ProbeCenter new];delegate=[ProbeDelegate new];[plugin setValue:center forKey:@"center"];[plugin setValue:delegate forKey:@"commandDelegate"];
 delegate.result=^(CDVPluginResult*r){
  BOOL expectError=(stage==1||stage==3);BOOL ok=r.status.intValue==(expectError?CDVCommandStatus_ERROR:CDVCommandStatus_OK);
  if(stage==0)ok=ok&&center.count==2;
  if(stage==1)ok=ok&&center.count==2;
  if(stage==2)ok=ok&&center.count==1;
  if(!ok){NSLog(@"IOS_NATIVE_PROBE_FAIL stage=%d status=%@ count=%d",stage,r.status,center.count);return;}
  NSLog(@"IOS_NATIVE_PROBE_PASS stage=%d",stage);stage++;
  dispatch_async(dispatch_get_main_queue(),^{
   if(stage==1){center.count=0;center.failAt=2;invoke(@"schedule",@[options(3),options(4),options(5)]);}
   else if(stage==2){center.count=0;center.failAt=0;invoke(@"update",@[options(1),options(99999)]);}
   else if(stage==3){center.authError=YES;invoke(@"requestPermission",@[]);}
   else if(stage==4){center.authError=NO;invoke(@"schedule",@[]);}
   else NSLog(@"IOS_NATIVE_PROBE_ALL_PASS");
  });
 };
 invoke(@"schedule",@[options(1),options(2)]);
});}
