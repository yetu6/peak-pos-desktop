import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {loadLocalPosCore,type LocalOrderView} from "../lib/localPosCore";
import {getApiBaseUrl} from "../lib/peakConfig";
import {getOperationalSession} from "../lib/operationalSession";

let corePromise:ReturnType<typeof loadLocalPosCore>|null=null;
function core(){corePromise??=loadLocalPosCore();return corePromise}
const draftKey=["local-pos","current-draft"] as const;

export function useLocalCatalog(query:string,categoryId?:string){return useQuery({queryKey:["local-pos","catalog",query,categoryId],queryFn:async()=>(await core()).catalog(query||undefined,categoryId),retry:false,staleTime:30_000})}
export function useLocalDraft(defaultServiceType?:string){const session=getOperationalSession();const queryClient=useQueryClient();const draft=useQuery({queryKey:[...draftKey,session?.staffId],queryFn:async()=>(await core()).getOrCreateDraft({serviceType:defaultServiceType!}),enabled:Boolean(session?.staffId&&defaultServiceType),retry:false});const set=(view:LocalOrderView)=>queryClient.setQueryData([...draftKey,session?.staffId],view);return{draft,
  addItem:useMutation({mutationFn:async(args:{productId:string;quantity:number;modifierOptionIds:string[]})=>{if(!draft.data)throw new Error("LOCAL_DRAFT_REQUIRED");return(await core()).addItem({orderId:draft.data.id,expectedVersion:draft.data.version,...args})},onSuccess:set}),
  setQuantity:useMutation({mutationFn:async(args:{lineId:string;quantity:number})=>{if(!draft.data)throw new Error("LOCAL_DRAFT_REQUIRED");return(await core()).setQuantity(draft.data.id,args.lineId,args.quantity,draft.data.version)},onSuccess:set}),
  removeLine:useMutation({mutationFn:async(lineId:string)=>{if(!draft.data)throw new Error("LOCAL_DRAFT_REQUIRED");return(await core()).removeLine(draft.data.id,lineId,draft.data.version)},onSuccess:set}),
  updateContext:useMutation({mutationFn:async(args:{serviceType:string;tableLabel?:string;notes?:string})=>{if(!draft.data)throw new Error("LOCAL_DRAFT_REQUIRED");return(await core()).updateContext({orderId:draft.data.id,expectedVersion:draft.data.version,...args})},onSuccess:set}),
  commit:useMutation({mutationFn:async()=>{if(!draft.data)throw new Error("LOCAL_DRAFT_REQUIRED");return(await core()).commitOrder(draft.data.id,draft.data.version)},onSuccess:(view)=>{set(view);queryClient.invalidateQueries({queryKey:["pos","orders"]})}}),
  settleCash:useMutation({mutationFn:async(cashReceivedMinor:number)=>{if(!draft.data)throw new Error("LOCAL_DRAFT_REQUIRED");return(await core()).settleCash(draft.data.id,draft.data.version,cashReceivedMinor)},onSuccess:(result)=>{set(result.order);queryClient.setQueryData(["local-pos","sync"],{status:"Offline",queuedOperations:1});const current=getOperationalSession();if(current)void core().then(native=>native.retrySync(getApiBaseUrl(),current.token)).then(state=>queryClient.setQueryData(["local-pos","sync"],state)).catch(()=>undefined)}})
}}
