// Compile the production options class and delegate methods against Apple's frameworks.
#import <Foundation/Foundation.h>
#import "APPNotificationOptions.h"
#import "UNNotificationRequest+APPLocalNotification.h"

NSString * const kAPPGeneralCategory = @"APP_GENERAL";

static void check(BOOL condition, NSString* message) {
    if (!condition) {
        NSLog(@"FAIL: %@", message);
        exit(1);
    }
}

@interface NotificationProbe : NSObject
@property id request;
@end
@implementation NotificationProbe @end
@interface ResponseProbe : NSObject
@property NotificationProbe* notification;
@property NSString* actionIdentifier;
@end
@implementation ResponseProbe @end
@interface PushTriggerProbe : NSObject @end
@implementation PushTriggerProbe
- (BOOL)isKindOfClass:(Class)type { return type == UNPushNotificationTrigger.class || [super isKindOfClass:type]; }
@end
@interface RequestProbe : NSObject
@property id trigger;
@property UNNotificationContent* content;
@end
@implementation RequestProbe @end

@interface PreviousDelegate : NSObject <UNUserNotificationCenterDelegate>
@property NSUInteger presentations;
@property NSUInteger responses;
@end
@implementation PreviousDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter*)center willPresentNotification:(UNNotification*)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
    self.presentations++;
    completion(UNNotificationPresentationOptionNone);
}
- (void)userNotificationCenter:(UNUserNotificationCenter*)center didReceiveNotificationResponse:(UNNotificationResponse*)response withCompletionHandler:(void (^)(void))completion {
    self.responses++;
    completion();
}
@end

@interface APPLocalNotification : NSObject <UNUserNotificationCenterDelegate> {
@public
    BOOL isActive;
    BOOL deviceready;
    NSArray* _launchDetails;
}
@property (weak) id<UNUserNotificationCenterDelegate> delegate;
@property NSMutableArray* events;
- (BOOL)isPluginNotification:(UNNotificationRequest*)request;
- (void)fireEvent:(NSString*)event notification:(UNNotificationRequest*)request;
- (void)fireEvent:(NSString*)event notification:(UNNotificationRequest*)request data:(NSDictionary*)data;
@end
@implementation APPLocalNotification
- (instancetype)init { self = [super init]; if (self) { isActive = YES; deviceready = YES; self.events = [NSMutableArray array]; } return self; }
- (void)fireEvent:(NSString*)event notification:(UNNotificationRequest*)request { [self.events addObject:event]; }
- (void)fireEvent:(NSString*)event notification:(UNNotificationRequest*)request data:(NSDictionary*)data { [self.events addObject:event]; }
#include "notification-delegates.inc"
@end

static NotificationProbe* notification(NSString* plugin, BOOL foreground, BOOL silent) {
    UNMutableNotificationContent* content = [UNMutableNotificationContent new];
    content.userInfo = @{ @"meta": @{ @"plugin": plugin }, @"id": @1,
                          @"iOSForeground": @(foreground), @"silent": @(silent) };
    NotificationProbe* result = [NotificationProbe new];
    result.request = [UNNotificationRequest requestWithIdentifier:@"1" content:content trigger:nil];
    return result;
}

int main() { @autoreleasepool {
    APPNotificationOptions* options = [[APPNotificationOptions alloc] initWithDict:@{ @"trigger": @{ @"type": @"calendar" } }];
    check(options.trigger == nil, @"no date or interval must use Apple's immediate nil trigger");
    options = [[APPNotificationOptions alloc] initWithDict:@{ @"trigger": @{ @"in": @2, @"unit": @"minute" } }];
    check([options.trigger isKindOfClass:UNTimeIntervalNotificationTrigger.class], @"relative trigger type");
    check(((UNTimeIntervalNotificationTrigger*)options.trigger).timeInterval == 120, @"relative interval unchanged");
    NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:30];
    options = [[APPNotificationOptions alloc] initWithDict:@{ @"trigger": @{ @"in": @2, @"unit": @"minute" }, @"relativeTriggerDate": deadline }];
    UNTimeIntervalNotificationTrigger* updated = (id)options.trigger;
    check(fabs([updated.nextTriggerDate timeIntervalSinceDate:deadline]) < 0.1, @"text update preserves original relative deadline");
    check(!options.userInfo[@"relativeTriggerDate"], @"internal deadline is omitted from returned options");
    for (NSNumber* delta in @[@120, @0.75, @(-1), @(-10)]) {
        NSDate* date = [NSDate dateWithTimeIntervalSinceNow:delta.doubleValue];
        options = [[APPNotificationOptions alloc] initWithDict:@{ @"trigger": @{ @"at": @([date timeIntervalSince1970] * 1000) } }];
        UNNotificationTrigger* trigger = options.trigger;
        if (delta.doubleValue > 0) {
            check([trigger isKindOfClass:UNTimeIntervalNotificationTrigger.class], @"future date uses an interval without calendar rounding");
            check(fabs([((UNTimeIntervalNotificationTrigger*)trigger).nextTriggerDate timeIntervalSinceDate:date]) < 0.1, @"future instant preserved including milliseconds");
        } else {
            check(trigger == nil, @"a date accepted by schedule() can become due before native submission");
        }
    }
    options = [[APPNotificationOptions alloc] initWithDict:@{ @"trigger": @{ @"every": @"day", @"at": @1800000000000 } }];
    check([options.trigger isKindOfClass:UNCalendarNotificationTrigger.class] && options.trigger.repeats, @"daily recurrence stays a repeating calendar trigger");

    UNUserNotificationCenter* center = (id)[NSObject new];
    APPLocalNotification* plugin = [APPLocalNotification new];
    PreviousDelegate* previous = [PreviousDelegate new];
    plugin.delegate = previous;
    __block NSUInteger completions = 0;
    __block UNNotificationPresentationOptions flags = 0;
    void (^present)(UNNotificationPresentationOptions) = ^(UNNotificationPresentationOptions value) { completions++; flags = value; };
    void (^respond)(void) = ^{ completions++; };
    NotificationProbe* local = notification(@"cordova-plugin-local-notifications-continued", YES, NO);
    [plugin userNotificationCenter:center willPresentNotification:(id)local withCompletionHandler:present];
    check(completions == 1 && previous.presentations == 0, @"local foreground notification completes once without forwarding");
    check((flags & UNNotificationPresentationOptionBanner) && (flags & UNNotificationPresentationOptionSound), @"banner and sound requested");
    for (NSNumber* silent in @[@NO, @YES]) {
        completions = 0;
        NotificationProbe* hidden = notification(@"cordova-plugin-local-notifications-continued", NO, silent.boolValue);
        [plugin userNotificationCenter:center willPresentNotification:(id)hidden withCompletionHandler:present];
        check(completions == 1 && !(flags & UNNotificationPresentationOptionBanner), @"foreground false or silent suppresses banner");
        check(silent.boolValue ? flags == 0 : (flags & UNNotificationPresentationOptionSound) != 0, @"sound respects silent");
    }
    check([plugin isPluginNotification:notification(@"cordova-plugin-local-notification", YES, NO).request], @"original plugin notifications remain recognized");
    ResponseProbe* response = [ResponseProbe new]; response.notification = local;
    response.actionIdentifier = UNNotificationDefaultActionIdentifier;
    completions = 0;
    [plugin userNotificationCenter:center didReceiveNotificationResponse:(id)response withCompletionHandler:respond];
    check(completions == 1 && previous.responses == 0 && [plugin.events containsObject:@"click"], @"local click completes once and fires local event");

    NotificationProbe* foreign = notification(@"another-plugin", YES, NO);
    NotificationProbe* remote = [NotificationProbe new];
    RequestProbe* remoteRequest = [RequestProbe new]; remoteRequest.trigger = [PushTriggerProbe new];
    remoteRequest.content = [UNMutableNotificationContent new]; remote.request = remoteRequest;
    // Even remote payloads bearing our metadata belong to the push delegate.
    ((UNMutableNotificationContent*)remoteRequest.content).userInfo = ((UNNotificationRequest*)local.request).content.userInfo;
    for (NotificationProbe* other in @[foreign, remote]) {
        [plugin.events removeAllObjects];
        NSUInteger presentations = previous.presentations, responses = previous.responses;
        completions = 0;
        [plugin userNotificationCenter:center willPresentNotification:(id)other withCompletionHandler:present];
        check(completions == 1 && previous.presentations == presentations + 1 && flags == 0, @"other notification presentation belongs to the previous delegate");
        response.notification = other; completions = 0;
        [plugin userNotificationCenter:center didReceiveNotificationResponse:(id)response withCompletionHandler:respond];
        check(completions == 1 && previous.responses == responses + 1 && plugin.events.count == 0, @"other notification response is forwarded without local events");
    }
    NSObject* optional = [NSObject new];
    for (id delegate in @[optional, NSNull.null]) {
        plugin.delegate = delegate == NSNull.null ? nil : delegate;
        completions = 0;
        [plugin userNotificationCenter:center willPresentNotification:(id)remote withCompletionHandler:present];
        check(completions == 1 && flags == 0, @"missing optional presentation method has safe completion");
        response.notification = remote; completions = 0;
        [plugin userNotificationCenter:center didReceiveNotificationResponse:(id)response withCompletionHandler:respond];
        check(completions == 1, @"missing optional response method has safe completion");
    }
    puts("IOS_NOTIFICATION_DELIVERY_PASS");
    return 0;
} }
