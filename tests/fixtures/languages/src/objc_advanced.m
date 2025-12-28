#import <Foundation/Foundation.h>

@interface OCGreeter : NSObject
- (NSString *)objcGreet:(NSString *)name;
@end

@implementation OCGreeter
- (NSString *)objcGreet:(NSString *)name {
    return [NSString stringWithFormat:@"Hi %@", name];
}
@end

int add_numbers(int a, int b) {
    return a + b;
}

int use_add_numbers(int a, int b) {
    return add_numbers(a, b);
}
