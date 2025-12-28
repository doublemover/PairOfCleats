#import <Foundation/Foundation.h>

/// Objective-C greeter protocol.
@protocol OCGreeter
- (NSString *)objcGreet:(NSString *)name;
@end

@interface OCGreeterImpl : NSObject <OCGreeter>
- (NSString *)objcGreet:(NSString *)name;
@end

@implementation OCGreeterImpl
- (NSString *)objcGreet:(NSString *)name {
  return [NSString stringWithFormat:@"hello %@", name];
}
@end
