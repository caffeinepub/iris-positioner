import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface Point2D {
    x: number;
    y: number;
}
export interface EyeLandmarks {
    irisCenter: Point2D;
    lateralCanthus: Point2D;
    medialCanthus: Point2D;
}
export interface SessionData {
    defectiveEye: {
        lateralCanthus: Point2D;
        medialCanthus: Point2D;
    };
    normalEye: EyeLandmarks;
    calculatedIris: Point2D;
}
export interface backendInterface {
    getAllSessionsSorted(): Promise<Array<SessionData>>;
    getSession(): Promise<SessionData>;
    hasSession(): Promise<boolean>;
    saveSession(data: SessionData): Promise<void>;
}
