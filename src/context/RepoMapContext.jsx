"use client";

import { createContext, useCallback, useContext, useRef } from "react";

const RepoMapContext = createContext({
  repoMap: null,
  setRepoMap: () => {},
  requestSummary: async () => {},
  requestNodeDetail: async () => {},
  getDescriptionForPath: () => "",
  getDomainForPath: () => null,
  getPointersForPath: () => [],
  getRoleForPath: () => "",
  getWorkflowForPath: () => ({
    function: "",
    inputs: "",
    outputs: "",
    process: "",
  }),
  navigateToPath: async () => {},
  registerGraphNavigator: () => () => {},
});

export function RepoMapProvider({
  repoMap,
  setRepoMap,
  requestSummary,
  requestNodeDetail,
  getDescriptionForPath,
  getDomainForPath,
  getPointersForPath,
  getRoleForPath,
  getWorkflowForPath,
  children,
}) {
  const navigateRef = useRef(null);

  const registerGraphNavigator = useCallback((fn) => {
    navigateRef.current = fn;
    return () => {
      if (navigateRef.current === fn) navigateRef.current = null;
    };
  }, []);

  const navigateToPath = useCallback(async (path) => {
    if (navigateRef.current) {
      await navigateRef.current(path);
    }
  }, []);

  return (
    <RepoMapContext.Provider
      value={{
        repoMap,
        setRepoMap,
        requestSummary,
        requestNodeDetail,
        getDescriptionForPath,
        getDomainForPath,
        getPointersForPath,
        getRoleForPath,
        getWorkflowForPath,
        navigateToPath,
        registerGraphNavigator,
      }}
    >
      {children}
    </RepoMapContext.Provider>
  );
}

export function useRepoMapContext() {
  return useContext(RepoMapContext);
}
