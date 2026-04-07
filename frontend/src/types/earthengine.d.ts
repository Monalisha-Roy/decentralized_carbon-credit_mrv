declare module '@google/earthengine' {
  namespace ee {
    function initialize(
      baseurl?: string | null,
      tileurl?: string | null,
      successCallback?: () => void,
      errorCallback?: (error: Error) => void
    ): void;

    namespace data {
      function authenticateViaPrivateKey(
        credentials: { client_email: string; private_key: string },
        success: () => void,
        error: (error: Error) => void
      ): void;
    }

    class Geometry {
      static Polygon(coords: number[][][]): Geometry;
    }

    class Image {
      static pixelArea(): Image;
      normalizedDifference(bands: string[]): Image;
      expression(expression: string, map: { [key: string]: Image }): Image;
      select(bands: string | string[]): Image;
      addBands(image: Image): Image;
      rename(name: string): Image;
      updateMask(mask: Image): Image;
      divide(value: number): Image;
      bitwiseAnd(value: number): Image;
      eq(value: number): Image;
      and(image: Image): Image;
      reduceRegion(args: {
        reducer: any;
        geometry: Geometry;
        scale: number;
        maxPixels: number;
      }): any;
      getMap(visParams: any, callback: (mapId: any, error: any) => void): void;
    }

    class ImageCollection {
      constructor(id: string);
      static (id: string): ImageCollection;
      filterBounds(geometry: Geometry): ImageCollection;
      filterDate(start: string, end: string): ImageCollection;
      filter(filter: any): ImageCollection;
      map(callback: (image: Image) => Image): ImageCollection;
      select(bands: string | string[]): ImageCollection;
      median(): Image;
      mean(): Image;
      first(): Image;
      mode(): Image;
    }

    namespace Filter {
      function lt(property: string, value: number): any;
    }

    interface Reducer {
      combine(args: { reducer2: any; sharedInputs: boolean }): Reducer;
      group(args: { groupField: number; groupName: string }): Reducer;
    }

    namespace Reducer {
      function sum(): Reducer;
      function mean(): Reducer;
      function minMax(): Reducer;
    }

    namespace batch {
      namespace Export {
        namespace image {
          function toDrive(params: {
            image: Image;
            description: string;
            scale: number;
            region: Geometry;
            fileFormat: string;
            maxPixels: number;
          }): any;
        }
      }
    }
  }

  export = ee;
}
