declare module 'opencc-js' {
    export type LocaleTag = 'cn' | 'hk' | 'tw' | 'twp' | 'jp';

    export function Converter(options: {
        from: LocaleTag;
        to: LocaleTag;
    }): (input: string) => string;
}
