import Nat "mo:core/Nat";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";

actor {
  type Point2D = {
    x : Float;
    y : Float;
  };

  type EyeLandmarks = {
    medialCanthus : Point2D;
    lateralCanthus : Point2D;
    irisCenter : Point2D;
  };

  type SessionData = {
    normalEye : EyeLandmarks;
    defectiveEye : {
      medialCanthus : Point2D; // No irisInitially
      lateralCanthus : Point2D;
    };
    calculatedIris : Point2D;
  };

  // Store sessions data
  let sessions = Map.empty<Principal, SessionData>();

  public shared ({ caller }) func saveSession(data : SessionData) : async () {
    sessions.add(caller, data);
  };

  public shared ({ caller }) func getSession() : async SessionData {
    switch (sessions.get(caller)) {
      case (null) { Runtime.trap("No session data found") };
      case (?data) { data };
    };
  };

  public query ({ caller }) func hasSession() : async Bool {
    sessions.containsKey(caller);
  };

  public query ({ caller }) func getAllSessionsSorted() : async [SessionData] {
    sessions.values().toArray();
  };
};
